import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const C = await loadCore();
C.setDoc(C.SAMPLE);
const T = C.state.target;

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

// ── resolveResumeCursor: 保存値の妥当性判定 ──

test("本文の長さ以内ならそのまま使う", () => {
  assert.equal(C.resolveResumeCursor(50, 100), 50);
  assert.equal(C.resolveResumeCursor(0, 100), 0);
});

test("ちょうど本文末でも有効（読み終わった状態）", () => {
  assert.equal(C.resolveResumeCursor(100, 100), 100);
});

test("本文の長さを超えていたら先頭にフォールバックする（改版等でずれた場合）", () => {
  assert.equal(C.resolveResumeCursor(1000, 100), 0, "末尾に丸めない。読了扱いに化けてしまうため");
});

test("不正な値（負・非数）も先頭にフォールバックする", () => {
  assert.equal(C.resolveResumeCursor(-1, 100), 0);
  assert.equal(C.resolveResumeCursor(null, 100), 0);
  assert.equal(C.resolveResumeCursor(undefined, 100), 0);
  assert.equal(C.resolveResumeCursor("50", 100), 0, "数値以外は受け付けない");
});

// ── loadBookmark / saveBookmark / clearBookmark ──

test("save→load のラウンドトリップ", () => {
  withStorage(new MemoryStorage(), () => {
    C.saveBookmark("000148/789", 42);
    assert.equal(C.loadBookmark("000148/789"), 42);
  });
});

test("未保存の作品IDは null", () => {
  withStorage(new MemoryStorage(), () => {
    assert.equal(C.loadBookmark("no-such-id"), null);
  });
});

test("作品IDごとに独立している", () => {
  withStorage(new MemoryStorage(), () => {
    C.saveBookmark("a", 10);
    C.saveBookmark("b", 20);
    assert.equal(C.loadBookmark("a"), 10);
    assert.equal(C.loadBookmark("b"), 20);
  });
});

test("clearBookmark で消える", () => {
  withStorage(new MemoryStorage(), () => {
    C.saveBookmark("000148/789", 42);
    C.clearBookmark("000148/789");
    assert.equal(C.loadBookmark("000148/789"), null);
  });
});

test("localStorage が使えない環境でも例外を出さず「データなし」扱い", () => {
  assert.equal(typeof globalThis.localStorage, "undefined", "前提: localStorage 不在で走る");
  assert.doesNotThrow(() => {
    assert.equal(C.loadBookmark("000148/789"), null);
    C.saveBookmark("000148/789", 1);
    C.clearBookmark("000148/789");
  });
});

// ── engineReset(at): 途中から始める入口（issue #17）──

test("engineReset(at): cursor と DP のアンカーが at に置かれ、typed は空", () => {
  C.engineReset(50);
  assert.equal(C.state.cursor, 50);
  assert.equal(C.state.anchorT, 50, "DP のアンカーがしおり位置に置かれる");
  assert.equal(C.state.anchorK, 0, "typed 側の起点はゼロ（過去の入力は復元しない）");
  assert.equal(C.state.typed.length, 0);
  C.engineReset(0);
});

test("engineReset(at): 範囲外の値は防御的に本文長へ丸める", () => {
  C.engineReset(T.length + 999);
  assert.equal(C.state.cursor, T.length);
  C.engineReset(-5);
  assert.equal(C.state.cursor, 0);
  C.engineReset(0);
});

test("engineReset(at): 引数省略時は先頭からと同じ", () => {
  C.engineReset();
  assert.equal(C.state.cursor, 0);
  assert.equal(C.state.anchorT, 0);
});

test("engineReset(at): しおり位置から正しく判定を継続できる", () => {
  const at = 50;
  C.engineReset(at);
  for (const ch of T.slice(at, at + 30)) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  assert.equal(C.state.cursor, at + 30);
  assert.ok(C.state.typed.every(t => t.cls === "ok"));
  C.engineReset(0);
});

test("engineReset(at): 誤入力からの自己回復も at 起点で成り立つ", () => {
  const at = 80;
  C.engineReset(at);
  const s = T.slice(at, at + 10) + "ヌヌ" + T.slice(at + 10, at + 30);
  for (const ch of s) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  assert.equal(C.state.cursor, at + 30);
  C.engineReset(0);
});

test("engineReset(at): テープ側が参照する tokenOfTarget が at からも解決できる", () => {
  const at = 60;
  C.engineReset(at);
  const ti = C.state.tokenOfTarget[Math.min(C.state.cursor, T.length)];
  assert.ok(Number.isInteger(ti) && ti >= 0 && ti < C.state.tokens.length);
  C.engineReset(0);
});

// ── 自動挿入（改行・字下げ）の整合 ──
// start() は emFrozen を engineReset が丸めた cursor に揃える。ここでは
// renderRange をその値で直に呼び、at より手前の pre[] が混ざらないことを検査する。
function truthFrom(at, p, pre, T) {
  let s = "";
  for (let u = at; u <= p; u++) { if (pre[u]) s += pre[u]; if (u < p) s += T[u]; }
  return s;
}
const plain = h => h.replace(/<br>/g, "\n").replace(/<span[^>]*>([\s\S]*?)<\/span>/g, "$1");

// しおりより手前にも自動挿入がある位置を選ぶ（そうでないと em=0 との違いが見えない）
const autoIdx = Object.keys(C.state.pre).map(Number).filter(u => C.state.pre[u]).sort((a, b) => a - b);
const RESUME_AT = autoIdx[1];

test("再開時の描画: em をしおり位置に揃えると、それ以前の自動挿入文字列は混ざらない", () => {
  assert.ok(autoIdx.length >= 2, "テスト前提: SAMPLE に自動挿入位置が2つ以上ある");
  const pre = C.state.pre, at = RESUME_AT;

  C.engineReset(at);
  for (const ch of T.slice(at, at + 20)) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  const html = C.renderRange(0, C.state.typed.length, at, Math.min(C.state.cursor, T.length)).html;
  // しおり位置以降だけの truth と一致すること＝しおりより手前の自動挿入が紛れ込んでいないこと
  assert.equal(plain(html), truthFrom(at, C.state.cursor, pre, T));
  C.engineReset(0);
});

test("再開時の描画: em を 0 のまま(バグ再現)にすると、しおり以前の自動挿入が混入してしまう", () => {
  // このテストは「emFrozen を at に揃える」ことの必要性そのものを裏づける対照実験。
  const pre = C.state.pre, at = RESUME_AT;
  C.engineReset(at);
  for (const ch of T.slice(at, at + 20)) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  const buggyHtml = C.renderRange(0, C.state.typed.length, 0, Math.min(C.state.cursor, T.length)).html;
  assert.notEqual(plain(buggyHtml), truthFrom(at, C.state.cursor, pre, T),
    "em=0 だと at より前の自動挿入まで混じり、しおり位置からの描画と一致しなくなる");
  C.engineReset(0);
});
