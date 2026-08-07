import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./harness.mjs";

const C = await loadCore();
C.setDoc(C.SAMPLE);
const T = C.state.target;

// commit() と同じく1文字ずつ判定する
function type(input) {
  C.engineReset();
  for (const ch of input) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  return C.state;
}
function cls() { return C.state.typed.map(t => t.cls); }

test("記法パーサ: ルビの親文字を正しく判定する", () => {
  const ruby = C.state.tokens.filter(t => t.ruby).map(t => [t.ch, t.ruby, t.rubySpan]);
  assert.deepEqual(ruby, [
    ["見", "けんとう", 2], ["獰", "どうあく", 2],
    ["掌", "てのひら", 1], ["見", "みはじめ", 2],
  ]);
});

test("記法パーサ: 改行と行頭全角スペースは入力対象外", () => {
  assert.ok(!T.includes("\n"));
  const autos = Object.entries(C.state.pre).filter(([, v]) => v);
  assert.ok(autos.length >= 2);
  for (const [, v] of autos) assert.match(v, /^\n　?$/);
});

test("完全一致で cursor が追従する", () => {
  assert.equal(type(T.slice(0, 20)).cursor, 20);
  assert.ok(cls().every(c => c === "ok"));
});

test("置換ミス: cursor は進み、その1文字だけ ng", () => {
  const s = T.slice(0, 20).split(""); s[4] = "X";
  assert.equal(type(s.join("")).cursor, 20);
  assert.deepEqual(cls().map((c, i) => c === "ng" ? i : -1).filter(i => i >= 0), [4]);
});

test("挿入ミス: 余計に打った分だけ cursor が遅れない", () => {
  assert.equal(type(T.slice(0, 10) + "XX" + T.slice(10, 20)).cursor, 20);
  assert.equal(cls().filter(c => c === "ng").length, 2);
});

test("脱落: 打ち漏らしを認めて先へ進む", () => {
  assert.equal(type(T.slice(0, 10) + T.slice(12, 22)).cursor, 22);
  assert.ok(cls().every(c => c === "ok"));
});

test("無関係な文字列を10文字打ち込んでも自己回復する", () => {
  const s = T.slice(0, 20) + "あいうえおかきくけこ" + T.slice(20, 60);
  assert.equal(type(s).cursor, 60);
  assert.equal(cls().filter(c => c === "ng").length, 10);
});

test("アンカーが進んでも長文で cursor がずれない", () => {
  assert.equal(type(T.slice(0, 150)).cursor, 150);
  assert.ok(C.state.anchorK > 0, "アンカーが前進していること");
});

// ── 半角／全角の統一（issue #2） ──

test("半角化: 英字・数字・記号は寄せ、全角スペースと和文はそのまま", () => {
  assert.equal(C.toHalf("ＡＢＣａｂｃ０１２"), "ABCabc012");
  assert.equal(C.toHalf("！＃＄％＆（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～"),
                        '!#$%&()*+,-./:;<=>?@[\\]^_`{|}~');
  assert.equal(C.toHalf("　"), "　", "全角スペースは統一対象外");
  assert.equal(C.toHalf("吾輩は猫である。"), "吾輩は猫である。");
  assert.equal(C.toHalf("〜―…"), "〜―…", "波ダッシュ・ダーシ・三点リーダは記号ではなく約物");
});

test("お手本の半角化は記法パーサより後に掛かる（｜と＃を壊さない）", () => {
  const d = C.parseAozora("｜ＸＹ《えっくすわい》です［＃改ページ］ＡＢ");
  assert.equal(d.target, "XYですAB");
  const ruby = d.tokens.filter(t => t.ruby).map(t => [t.ch, t.ruby, t.rubySpan]);
  assert.deepEqual(ruby, [["X", "えっくすわい", 2]], "｜ が半角化されるとルビ範囲が壊れる");
});

test("半角スペースは手動入力のまま、行頭の全角スペースだけ自動入力", () => {
  const d = C.parseAozora("Ｉ ａｍ ａ ｃａｔ。\n　つぎの行");
  assert.equal(d.target, "I am a cat。つぎの行", "英文中の半角スペースは打鍵対象として残す");
  // 自動入力されるのは改行と行頭の全角スペースだけ
  assert.deepEqual(Object.values(d.pre).filter(Boolean), ["\n　"]);
});

test("行頭でない全角スペースは半角化も自動入力もされない", () => {
  const d = C.parseAozora("あ　い");
  assert.equal(d.target, "あ　い");
  assert.deepEqual(Object.values(d.pre).filter(Boolean), []);
});

test("入力の半角化: 全角で打っても半角のお手本と一致する", () => {
  C.setDoc({ title: "t", author: "", text: "Ａ Ｂ１" });
  assert.equal(C.state.target, "A B1");
  C.engineReset();
  for (const ch of C.normalizeInput("Ａ Ｂ１")) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  assert.equal(C.state.cursor, 4);
  assert.ok(C.state.typed.every(t => t.cls === "ok"));
  assert.equal(C.state.typed.map(t => t.ch).join(""), "A B1", "描画も半角で残る");
  C.setDoc(C.SAMPLE);
});

test("字幅クラス: 半角スペース以外の ASCII だけ全角1マスに揃える", () => {
  for (const ch of "AZaz09!~|\\") assert.equal(C.zenCls(ch), " zen", ch);
  assert.equal(C.zenCls(" "), "", "半角スペースは実幅のまま");
  for (const ch of "あ漢　。") assert.equal(C.zenCls(ch), "", ch);
});

test("字幅クラスはテープと入力欄の両方に同じものが付く", () => {
  C.setDoc({ title: "t", author: "", text: "Ａあ" });
  C.engineReset();
  for (const ch of "Aあ") { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  const html = C.renderRange(0, 2, 0, 2).html;
  assert.match(html, /<span class="ok zen">A<\/span>/);
  assert.match(html, /<span class="ok">あ<\/span>/);
  C.setDoc(C.SAMPLE);
});

// ── ファズ：ランダムな変換単位と誤入力で、自動挿入位置が常に正しいこと ──
function truth(p, pre, T) {
  let s = "";
  for (let u = 0; u <= p; u++) { if (pre[u]) s += pre[u]; if (u < p) s += T[u]; }
  return s;
}
const plain = h => h.replace(/<br>/g, "\n").replace(/<span[^>]*>([\s\S]*?)<\/span>/g, "$1");

test("ファズ: 正しく打つ限り、描画結果は原文と完全に一致する", () => {
  const pre = C.state.pre;
  for (let seed = 1; seed <= 40; seed++) {
    C.engineReset();
    let rng = seed, i = 0;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
    while (i < T.length) {
      const n = 1 + Math.floor(rand() * 6);
      for (const ch of T.slice(i, i + n)) C.step(ch);
      i += n;
      C.reclassify(); C.maybeAnchor();
      const html = C.renderRange(0, C.state.typed.length, 0, Math.min(C.state.cursor, T.length)).html;
      assert.equal(plain(html), truth(Math.min(C.state.cursor, T.length), pre, T),
        `seed=${seed} cursor=${C.state.cursor}`);
    }
  }
});

test("ファズ: 誤入力35%でも改行・全角スペースの数が合う", () => {
  const pre = C.state.pre;
  const expBreaks = p => { let n = 0; for (let u = 0; u <= p; u++) if (pre[u]) n += (pre[u].match(/\n/g) || []).length; return n; };
  for (let seed = 1; seed <= 60; seed++) {
    C.engineReset();
    let rng = seed, i = 0;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
    while (i < T.length) {
      const n = 1 + Math.floor(rand() * 6);
      let chunk = T.slice(i, i + n); i += n;
      const r = rand();
      if (r < 0.14) chunk = "ヌ" + chunk;
      else if (r < 0.245) chunk = chunk.slice(1);
      else if (r < 0.35 && chunk) chunk = "ヌ" + chunk.slice(1);
      for (const ch of chunk) C.step(ch);
      C.reclassify(); C.maybeAnchor();
      const html = C.renderRange(0, C.state.typed.length, 0, Math.min(C.state.cursor, T.length)).html;
      assert.equal((plain(html).match(/\n/g) || []).length,
        expBreaks(Math.min(C.state.cursor, T.length)), `seed=${seed}`);
    }
  }
});
