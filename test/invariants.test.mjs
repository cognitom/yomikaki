// 実機バグから導出した「守らなければ壊れる」不変条件を、コード上で機械的に守らせる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf8");
const js = src.match(/<script>([\s\S]*)<\/script>/)[1];
const css = src.match(/<style>([\s\S]*)<\/style>/)[1];

test("鉄則①: composeEl は空にせず ZWSP を常駐させる", () => {
  assert.match(js, /const ZWSP\s*=\s*"\\u200B"/);
  assert.match(js, /function clearPending\(\)\{\s*composeEl\.textContent=ZWSP/);
});

test("鉄則②: Composition 系 inputType はブロックしない", () => {
  assert.match(js, /t\.indexOf\("Composition"\)>=0\)\s*return/);
});

test("鉄則③: 確定処理は setTimeout ではなくマイクロタスク", () => {
  assert.match(js, /queueMicrotask/);
  assert.doesNotMatch(js, /setTimeout\([^,]*,\s*0\s*\)/);
});

test("変換中はキャレットを動かさない", () => {
  assert.match(js, /if\(!composing\)\s*placeCaret\(\)/);
});

test("IME 経由のキー（Process / Unidentified）を打鍵から除外しない", () => {
  const mod = js.match(/const MOD=new Set\(\[(.*?)\]\)/)[1];
  for (const k of ["Process", "Unidentified", "Shift", "Dead"]) {
    assert.ok(!mod.includes(`"${k}"`), `${k} を除外してはいけない`);
  }
});

test("キーリピートを数えない", () => {
  assert.match(js, /if\(e\.repeat\)\s*return/);
});

test("入力欄とテープの letter-spacing が一致している", () => {
  assert.ok(/\.editor\{[\s\S]*?letter-spacing:normal/.test(css));
  assert.ok(/\.tape\{[\s\S]*?letter-spacing:normal/.test(css));
});

// ── 半角／全角の統一（issue #2）で新たに増えた不変条件 ──

test("英数字はテープでも入力欄でも可変幅のまま", () => {
  // 全角1マスに固定するとテープの見た目が不自然になる。両方とも実際の字幅に任せ、
  // 同じフォント・同じサイズ・letter-spacing:normal であることで字送りを一致させる。
  // どちらか片方だけに幅を与えると、ASCII を打つあいだテープが1文字ごとに揺れる。
  assert.doesNotMatch(css, /\.zen\b/);
  assert.doesNotMatch(js, /zenCls/);
  // セルに幅を与えてよいのは、入力欄に対応する文字を持たない ¶ だけ
  const withWidth = [...css.matchAll(/\.cell(\.[\w-]+)?\{[^}]*[^-]width:/g)].map(m => m[1]);
  assert.deepEqual(withWidth, [".brk"]);
});

test("入力欄とテープでカーニングを同じく切る", () => {
  // テープは1セル＝1文字の inline-block なのでペアカーニングが効かない。
  // 入力欄だけ AV / To のようなペアが詰まると、その差の分テープが左へ流れる。
  for (const [name, re] of [["editor", /\.editor\{[\s\S]*?\}/], ["tape", /\.tape\{[\s\S]*?\}/]]) {
    const block = css.match(re)[0];
    assert.match(block, /font-kerning:none/, name);
    assert.match(block, /font-variant-ligatures:none/, name);
  }
});

test("未描画セルの幅の推定が描画のしかたと対応している", () => {
  const est = js.match(/function estW\(i\)\{([\s\S]*?)\n\}/)[1];
  assert.match(est, /ch==="\\n"\) return brkW/, "¶ は .cell.brk で1マス固定");
  assert.match(est, /ch===" "\)  return spaceW/, "半角スペースは実測値");
  assert.match(est, /ASCII_VIS\.test\(ch\) \? halfW : fullW/);
  // 半角スペースと ¶ は実測する（フォント依存の値を決め打ちしない）
  assert.match(js, /probe\.textContent=" ";  spaceW=probe\.getBoundingClientRect\(\)\.width/);
  assert.match(js, /brkW=parseFloat\(getComputedStyle\(tape\)\.fontSize\)/);
});

test("半角スペースを潰さない", () => {
  // 入力欄で潰れると caretX が進まず、テープのセルで潰れると幅0になって字送りが壊れる
  assert.match(css, /\.editor\{[\s\S]*?white-space:pre-wrap/);
  assert.match(css, /\.cell\{[\s\S]*?white-space:pre/);
});

test("半角化は記法パーサより後に掛ける", () => {
  // ルビ区切り ｜(U+FF5C) と注記の ＃(U+FF03) は全角英数記号の範囲に入る。
  // 原文全体に先に掛けると、記法そのものが壊れる。
  const parse = js.match(/function parseAozora\(src\)\{([\s\S]*?)\n\}/)[1];
  const header = parse.slice(0, parse.indexOf("const tokens=[]"));
  assert.doesNotMatch(header, /toHalf/, "src 全体に掛けてはいけない");
  assert.match(js, /tokens\.push\(\{ch:toHalf\(c\)/, "トークン化時に一文字ずつ掛ける");
});

test("お手本と入力が同じ半角化関数を通る", () => {
  assert.match(js, /for\(const ch of normalizeInput\(s\)\)/);
  assert.match(js, /function normalizeInput\(s\)\{ return toHalf\(s\)/);
});

test("全角スペースは半角化の対象外", () => {
  // U+3000 を半角化すると、行頭の字下げが自動入力の対象から外れて境界が壊れる
  const re = js.match(/const ZENKAKU = (\/.*?\/g);/)[1];
  assert.equal(re, "/[\\uFF01-\\uFF5E]/g");
  assert.ok(!new RegExp(re.slice(1, -2)).test("\u3000"));
});
