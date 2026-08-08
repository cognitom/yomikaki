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

test("半角スペースの幅は入力欄・テープ・プローブの3つで揃える", () => {
  // word-spacing を1つでも掛け忘れると、そこだけ空白の送り幅が変わる。
  // .probe は estW（未描画セルの推定）で使う実測値なので、同じ条件で測らなければならない。
  assert.match(css, /--wordsp:/);
  for (const [name, re] of [["editor", /\.editor\{[\s\S]*?\}/],
                            ["tape",   /\.tape\{[\s\S]*?\}/],
                            ["probe",  /\.probe\{[^}]*\}/]]) {
    assert.match(css.match(re)[0], /word-spacing:var\(--wordsp\)/, name);
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

// ── テープの余白（issue #5）──

test("テープは上下とも同じ罫線で閉じる", () => {
  const wrap = css.match(/\.tapewrap\{[\s\S]*?\}/)[0];
  const top = wrap.match(/border-top:([^;]+);/)[1];
  const bottom = wrap.match(/border-bottom:([^;]+);/)[1];
  assert.equal(top, bottom, "下罫線は上罫線と同じ指定にする");
});

test("入力欄の下端は --tapeBand を基準に置く", () => {
  // テープの高さ・余白・セーフエリアを個別に足すと、余白を変えたときに
  // 入力欄がテープへ潜り込む。合計を1つの変数に閉じ込めて参照する。
  assert.match(css, /--tapeBand:calc\(var\(--tapeH\) \+ var\(--tapeGapB\) \+ var\(--safeB\)\)/);
  const stage = css.match(/\.stage\{[\s\S]*?\}/)[0];
  assert.match(stage, /bottom:calc\(var\(--tapeBand\)/);
  assert.ok(!/--tapeH|--safeB/.test(stage), "個別の値を直接足さない");
});

test("テープの高さは文字だけから導出する", () => {
  // 固定値で持つと --fs を変えたとき上下の余白が食い違う。
  // 「余白・文字・余白」と積むことで、文字が罫線のあいだの中央に来る。
  assert.match(css, /--tapeH:calc\(var\(--tapePadB\) \* 2 \+ var\(--fs\) \+ 2px\)/);
  // ルビは高さに数えない。全文字に付くものではないので、ルビぶんを積むと
  // ルビのない行では文字が下に寄って見える。
  assert.doesNotMatch(css, /--tapeH:[^;]*ruby/i);
  // 導出値をメディアクエリで上書きすると、その画面幅だけ均衡が崩れる
  const mq = css.match(/@media \(max-width:600px\)\{[\s\S]*?\n\}/)[0];
  assert.ok(!/--tapeH:/.test(mq), "--tapeH は上書きしない");
});

test("ルビが上の余白に収まる", () => {
  // 縦位置は文字だけで決め、ルビは上の余白へはみ出させている。
  // --tapePadB がルビの高さを下回ると .tapewrap の overflow:hidden で頭が切れる。
  const rt = css.match(/\.rt\{[\s\S]*?\}/)[0];
  assert.match(rt, /font-size:\.38em/);
  assert.match(rt, /padding-bottom:\.25em/);
  const rubyRatio = 0.38 * 1.25;            // line-height:1 なので font-size + padding だけ

  const vars = block => ({
    fs:  (block.match(/--fs:([\d.]+)rem/)  || [])[1],
    pad: (block.match(/--tapePadB:([\d.]+)rem/) || [])[1],
  });
  const root = vars(css.match(/^:root\{[\s\S]*?\n\}/m)[0]);
  const mq   = vars(css.match(/@media \(max-width:600px\)\{[\s\S]*?\n\}/)[0].match(/:root\{[^}]*\}/)[0]);

  for (const [name, v] of [["既定", root], ["〜600px", { ...root, ...clean(mq) }]]) {
    const fs = parseFloat(v.fs), pad = parseFloat(v.pad);
    assert.ok(pad >= fs * rubyRatio,
      `${name}: --tapePadB ${pad}rem がルビの高さ ${(fs * rubyRatio).toFixed(3)}rem 未満`);
  }
  function clean(o){ return Object.fromEntries(Object.entries(o).filter(([, x]) => x)); }
});

test("マーカーは文字を中心に対称に置く", () => {
  // 上下のはみ出しが違うと、1文字ぶんの高さしかない字に対して位置がずれて見える。
  const car = css.match(/\.tapecaret\{[\s\S]*?\}/)[0];
  assert.match(car, /bottom:calc\(var\(--tapePadB\) - var\(--tapeCaretPad\)\)/);
  assert.match(car, /height:calc\(var\(--fs\) \+ var\(--tapeCaretPad\) \* 2\)/);
  // はみ出し量が rem 固定だと、--fs を下げたとき相対的に長くなりすぎる
  assert.match(css, /--tapeCaretPad:calc\(var\(--fs\) \* \.33\)/);
});

// ── 類似記号の統一（issue #4）──

test("類似記号の統一は判定用キーにだけ掛ける", () => {
  // 表示まで寄せると 〇 と ○ の書き分けという原文の情報が消える。
  // トークンとテープは target（原文のまま）、照合は targetKey を使う。
  assert.match(js, /tokens\.push\(\{ch:toHalf\(c\)/, "トークンの字を寄せてはいけない");
  assert.doesNotMatch(js, /tokens\.push\(\{ch:unify/);
  assert.match(js, /Mloc = targetKey\.slice\(anchorT/, "照合窓は targetKey から切り出す");
  assert.match(js, /const key=unify\(ch\);\s*\n\s*typed\.push\(\{ch, key,/,
    "打った字は ch に残し、寄せた字は key に持つ");
});

test("正誤の比較は両側とも寄せた字で行う", () => {
  // 片側だけ寄せると、寄せ対象の記号が必ず ng になる
  assert.match(js, /const sub=prev\[j-1\]\+\(key===Mloc\[j-1\]\?0:1\)/);
  assert.match(js, /eq = j>0 && it\.key===Mloc\[j-1\]/);
});

// ── 入力スキップの対象（issue #3）──

test("スキップ規則はリストで持つ", () => {
  // 規則を条件式に散らすと追加できなくなる。3つのリストに閉じ込めておく。
  for (const name of ["NOISE_LINES", "AUTO_LINES"]) {
    assert.match(js, new RegExp(`const ${name} = \\[`), name);
  }
  // 文字単位の判定は同じ正規表現を何度も test() するので /g だと lastIndex で取りこぼす
  assert.match(js, /const AUTO_CHARS = \/\[[^\]]*\]\/;/);
});

test("スキップ規則は整形後テキストと同じ添字で参照する", () => {
  // applySkips が返す auto[] は「ノイズ行を抜いた後」の添字。src を差し替えてから
  // 走査しないと、抜けた行の分だけずれて無関係な文字が自動入力になる。
  const parse = js.match(/function parseAozora\(src\)\{([\s\S]*?)\n\}/)[1];
  const head = parse.slice(0, parse.indexOf("const tokens=[]"));
  assert.match(head, /const skip = applySkips\(src\); src = skip\.text;/);
  assert.match(parse, /typable:!skip\.auto\[i\]/);
});

test("スキップ規則は注記を除いた後に掛ける", () => {
  // ［＃…］が行に残っていると行全体の照合が効かず、見出しを拾えない
  const parse = js.match(/function parseAozora\(src\)\{([\s\S]*?)\n\}/)[1];
  assert.ok(parse.indexOf("［＃[^］]*］") < parse.indexOf("applySkips(src)"));
});

test("全角スペースは半角化の対象外", () => {
  // U+3000 を半角化すると、行頭の字下げが自動入力の対象から外れて境界が壊れる
  const re = js.match(/const ZENKAKU = (\/.*?\/g);/)[1];
  assert.equal(re, "/[\\uFF01-\\uFF5E]/g");
  assert.ok(!new RegExp(re.slice(1, -2)).test("\u3000"));
});
