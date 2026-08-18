import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const C = await loadCore();

// localStorage 相当のインメモリ実装。テストごとに差し替えて挙動を切り替える。
class MemoryStorage {
  constructor(){ this.data = new Map(); }
  getItem(k){ return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v){ this.data.set(k, String(v)); }
  removeItem(k){ this.data.delete(k); }
}
class ThrowingStorage {
  getItem(){ throw new DOMExceptionLike("SecurityError"); }
  setItem(){ throw new DOMExceptionLike("QuotaExceededError"); }
  removeItem(){ throw new DOMExceptionLike("SecurityError"); }
}
function DOMExceptionLike(name){ const e = new Error(name); e.name = name; return e; }

function withStorage(storage, fn){
  const saved = globalThis.localStorage;
  globalThis.localStorage = storage;
  try{ fn(); } finally {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  }
}

// ── 作品の同定 ──

test("workId: プリセット/カードURL経由は 人物ID/作品ID をそのまま使う", () => {
  assert.equal(C.workId({ person: "000148", work: "789", text: "…" }), "000148/789");
});

test("workId: 直接貼り付けは本文のハッシュで代用する", () => {
  const id = C.workId({ text: "吾輩は猫である。" });
  assert.match(id, /^paste:[0-9a-z]+$/);
});

test("workId: 同じ本文を貼り直せば同じIDになる", () => {
  const a = C.workId({ text: "同じ文章です。" });
  const b = C.workId({ text: "同じ文章です。" });
  assert.equal(a, b);
});

test("workId: 本文が違えば別のIDになる", () => {
  const a = C.workId({ text: "文章A" });
  const b = C.workId({ text: "文章B" });
  assert.notEqual(a, b);
});

test("hashText: 決定的で、空文字列でも例外を出さない", () => {
  assert.equal(C.hashText("abc"), C.hashText("abc"));
  assert.doesNotThrow(() => C.hashText(""));
});

// ── storageKey ──

test("storageKey: プレフィックスとスキーマバージョンを含む", () => {
  const key = C.storageKey("bookmark", "000148/789");
  assert.equal(key, `${C.STORAGE_PREFIX}:v${C.STORAGE_VERSION}:bookmark:000148/789`);
});

// ── localStorage の薄い抽象化 ──

test("storageGet/storageSet: 通常のラウンドトリップ", () => {
  withStorage(new MemoryStorage(), () => {
    const key = C.storageKey("bookmark", "000148/789");
    assert.equal(C.storageSet(key, { cursor: 42 }), true);
    assert.deepEqual(C.storageGet(key), { cursor: 42 });
  });
});

test("storageGet: 未保存のキーは null", () => {
  withStorage(new MemoryStorage(), () => {
    assert.equal(C.storageGet(C.storageKey("bookmark", "no-such-id")), null);
  });
});

test("storageGet: 壊れたJSONは「データなし」として扱う", () => {
  withStorage(new MemoryStorage(), () => {
    const key = C.storageKey("bookmark", "000148/789");
    localStorage.setItem(key, "{not valid json");
    assert.equal(C.storageGet(key), null);
  });
});

test("storageSet: 容量超過（QuotaExceededError）は例外を漏らさず false を返す", () => {
  withStorage(new ThrowingStorage(), () => {
    assert.equal(C.storageSet(C.storageKey("bookmark", "x"), { a: 1 }), false);
  });
});

test("storageGet: アクセス自体が例外を出す環境でも null を返す", () => {
  withStorage(new ThrowingStorage(), () => {
    assert.equal(C.storageGet(C.storageKey("bookmark", "x")), null);
  });
});

test("storageRemove: 例外が出ても上に漏らさない", () => {
  withStorage(new ThrowingStorage(), () => {
    assert.doesNotThrow(() => C.storageRemove(C.storageKey("bookmark", "x")));
  });
});

test("storage一式: localStorage が存在しない環境（プライベートブラウジング等）でも動作を続ける", () => {
  assert.equal(typeof globalThis.localStorage, "undefined", "前提: このテストは localStorage 不在で走る");
  const key = C.storageKey("bookmark", "000148/789");
  assert.doesNotThrow(() => {
    assert.equal(C.storageGet(key), null);
    assert.equal(C.storageSet(key, { cursor: 1 }), false);
    C.storageRemove(key);
  });
});

// ── 読み込み経路との整合 ──

test("SAMPLE はプリセットとして 人物ID/作品ID を持つ", () => {
  assert.equal(C.workId(C.SAMPLE), `${C.SAMPLE.person}/${C.SAMPLE.work}`);
});
