import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const C = await loadCore();

// index.html 側の MemoryStorage と同じ最小実装（storage.test.mjs 参照）
class MemoryStorage {
  constructor(){ this.data = new Map(); }
  getItem(k){ return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v){ this.data.set(k, String(v)); }
  removeItem(k){ this.data.delete(k); }
}
function withStorage(storage, fn){
  const saved = globalThis.localStorage;
  globalThis.localStorage = storage;
  try{ fn(); } finally {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  }
}

function rec(overrides={}){
  return C.buildSessionRecord({
    sessionStartedAt: 1000,
    workId: "000148/789", title: "吾輩は猫である", author: "夏目漱石",
    chars: 100, elapsedMs: 60000, keys: 150, commits: 12, typedLength: 155, ngCount: 8,
    ...overrides,
  });
}

// ── buildSessionRecord ──

test("buildSessionRecord: 生の数値だけを保持する（比率は保存しない）", () => {
  const r = rec();
  assert.equal(r.sid, 1000);
  assert.equal(r.at, 1000);
  assert.equal(r.workId, "000148/789");
  assert.equal(r.title, "吾輩は猫である");
  assert.equal(r.chars, 100);
  assert.equal(r.elapsedMs, 60000);
  assert.equal(r.keys, 150);
  assert.equal(r.commits, 12);
  assert.equal(r.typedLength, 155);
  assert.equal(r.ngCount, 8);
});

test("buildSessionRecord: 不正な数値は0側へ丸める（負値・NaN等を上に漏らさない）", () => {
  const r = rec({ chars: -5, elapsedMs: -1, keys: NaN, commits: -3, typedLength: NaN, ngCount: -1 });
  assert.equal(r.chars, 0);
  assert.equal(r.elapsedMs, 0);
  assert.equal(r.keys, 0);
  assert.equal(r.commits, 0);
  assert.equal(r.typedLength, 0);
  assert.equal(r.ngCount, 0);
});

test("buildSessionRecord: author 省略時は空文字列", () => {
  const r = rec({ author: undefined });
  assert.equal(r.author, "");
});

// ── isNoiseSession ──

test("isNoiseSession: 打鍵数が閾値未満はノイズ", () => {
  assert.equal(C.isNoiseSession(rec({ keys: C.MIN_SESSION_KEYS - 1 })), true);
});

test("isNoiseSession: 打鍵数が閾値以上ならノイズではない", () => {
  assert.equal(C.isNoiseSession(rec({ keys: C.MIN_SESSION_KEYS })), false);
});

// ── 表示用指標（README「統計の読み方」と同じ式）──

test("sessionEfficiency: keys / chars", () => {
  assert.equal(C.sessionEfficiency(rec({ chars: 100, keys: 150 })), 1.5);
});
test("sessionEfficiency: 進んだ字数が0なら null", () => {
  assert.equal(C.sessionEfficiency(rec({ chars: 0, keys: 3 })), null);
});
test("sessionAvgSegment: typedLength / commits", () => {
  assert.equal(C.sessionAvgSegment(rec({ typedLength: 60, commits: 12 })), 5);
});
test("sessionAvgSegment: 確定回数が0なら null", () => {
  assert.equal(C.sessionAvgSegment(rec({ typedLength: 0, commits: 0 })), null);
});
test("sessionMissRate: ngCount / typedLength", () => {
  assert.equal(C.sessionMissRate(rec({ typedLength: 200, ngCount: 20 })), 0.1);
});
test("sessionMissRate: 総入力文字数が0なら null", () => {
  assert.equal(C.sessionMissRate(rec({ typedLength: 0, ngCount: 0 })), null);
});

// ── upsertHistory ──

test("upsertHistory: 新しい sid は末尾に足す", () => {
  const a = rec({ sessionStartedAt: 1 });
  const b = rec({ sessionStartedAt: 2 });
  const next = C.upsertHistory([a], b);
  assert.deepEqual(next.map(r=>r.sid), [1,2]);
});

test("upsertHistory: 同じ sid は位置を保ったまま内容を置き換える", () => {
  const a = rec({ sessionStartedAt: 1, chars: 10 });
  const b = rec({ sessionStartedAt: 2, chars: 20 });
  const updatedA = rec({ sessionStartedAt: 1, chars: 999 });
  const next = C.upsertHistory([a,b], updatedA);
  assert.deepEqual(next.map(r=>r.sid), [1,2], "順序は変わらない");
  assert.equal(next[0].chars, 999, "内容は更新される");
});

test("upsertHistory: 上限を超えたら古いものから捨てる", () => {
  let history = [];
  for(let i=0;i<C.HISTORY_LIMIT+10;i++){
    history = C.upsertHistory(history, rec({ sessionStartedAt: i, chars: i }));
  }
  assert.equal(history.length, C.HISTORY_LIMIT);
  assert.equal(history[0].sid, 10, "先頭10件が捨てられている");
  assert.equal(history[history.length-1].sid, C.HISTORY_LIMIT+9);
});

// ── loadHistory / saveHistorySession ──

test("save→load のラウンドトリップ", () => {
  withStorage(new MemoryStorage(), () => {
    assert.equal(C.saveHistorySession(rec({ sessionStartedAt: 1 })), true);
    const list = C.loadHistory();
    assert.equal(list.length, 1);
    assert.equal(list[0].sid, 1);
  });
});

test("saveHistorySession: ノイズセッションは保存しない", () => {
  withStorage(new MemoryStorage(), () => {
    assert.equal(C.saveHistorySession(rec({ sessionStartedAt: 1, keys: 1 })), false);
    assert.deepEqual(C.loadHistory(), []);
  });
});

test("saveHistorySession: 同じセッションを複数回保存しても1件に統合される", () => {
  withStorage(new MemoryStorage(), () => {
    C.saveHistorySession(rec({ sessionStartedAt: 1, chars: 10 }));
    C.saveHistorySession(rec({ sessionStartedAt: 1, chars: 40 }));
    const list = C.loadHistory();
    assert.equal(list.length, 1);
    assert.equal(list[0].chars, 40, "最新の内容で上書きされる");
  });
});

test("loadHistory: 未保存なら空配列", () => {
  withStorage(new MemoryStorage(), () => {
    assert.deepEqual(C.loadHistory(), []);
  });
});

test("loadHistory: 壊れたデータ（配列でない）は空配列扱い", () => {
  withStorage(new MemoryStorage(), () => {
    localStorage.setItem(C.storageKey("history","log"), JSON.stringify({not:"array"}));
    assert.deepEqual(C.loadHistory(), []);
  });
});

test("localStorage が使えない環境でも例外を出さず「データなし」扱い", () => {
  assert.equal(typeof globalThis.localStorage, "undefined", "前提: localStorage 不在で走る");
  assert.doesNotThrow(() => {
    assert.deepEqual(C.loadHistory(), []);
    assert.equal(C.saveHistorySession(rec({ sessionStartedAt: 1 })), false);
  });
});
