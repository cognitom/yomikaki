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

test("記法パーサ: 改行と全角スペースは入力対象外", () => {
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

test("半角スペースは手動入力のまま、全角スペースは自動入力", () => {
  const d = C.parseAozora("Ｉ ａｍ ａ ｃａｔ。\n　つぎの行");
  assert.equal(d.target, "I am a cat。つぎの行", "英文中の半角スペースは打鍵対象として残す");
  // 自動入力されるのは改行と全角スペースだけ
  assert.deepEqual(Object.values(d.pre).filter(Boolean), ["\n　"]);
});

test("行頭でない全角スペースも自動入力になる（issue #21）", () => {
  const d = C.parseAozora("あ　い");
  assert.equal(d.target, "あい", "半角化はしないが打鍵対象からは外す");
  assert.deepEqual(Object.values(d.pre).filter(Boolean), ["　"]);
});

test("見出しの区切りの全角スペースは打たされない（issue #21）", () => {
  // 「こころ」の冒頭。二文字目の全角スペースが打鍵対象に残っていた
  const d = C.parseAozora("上　先生と私\n\n一\n\n　私はその人を常に先生と呼んでいた。");
  assert.equal(d.target.slice(0, 6), "上先生と私私");
  assert.equal(d.pre[1], "　", "「上」の直後の全角スペースが自動入力になる");
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

test("入力欄の描画は英数字にも幅を指定しない（可変幅のまま）", () => {
  C.setDoc({ title: "t", author: "", text: "Ａあ" });
  C.engineReset();
  for (const ch of "Aあ") { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  const html = C.renderRange(0, 2, 0, 2).html;
  assert.equal(html, '<span class="ok">A</span><span class="ok">あ</span>');
  C.setDoc(C.SAMPLE);
});

// 描画結果からタグを剥がして素のテキストに戻す
const plain = h => h.replace(/<br>/g, "\n").replace(/<span[^>]*>([\s\S]*?)<\/span>/g, "$1");

// ── 入力スキップの対象（issue #3） ──

// pre[] に溜まった自動入力文字をすべて連結する（テープには出るが打鍵対象ではないもの）
const autos = d => Object.values(d.pre).filter(Boolean).join("");
// トークン列を復元する。ノイズ行はここにも現れない
const tapeText = d => d.tokens.filter(t => !t.end).map(t => t.ch).join("");

test("章見出しの行は自動入力になり、本文としては残る", () => {
  const d = C.parseAozora("第一章\n本文です。");
  assert.equal(d.target, "本文です。", "見出しは打鍵対象から外れる");
  assert.equal(autos(d), "第一章\n", "見出しと改行は自動入力される");
  assert.ok(tapeText(d).startsWith("第一章"), "テープには残る");
});

test("章見出しのいろいろな書き方を拾う", () => {
  for (const h of ["第一章", "第2章 出発", "三", "12", "序", "あとがき", "幕間", "＊＊＊"]) {
    const d = C.parseAozora(h + "\n本文です。");
    assert.equal(d.target, "本文です。", `見出しとして扱われていない: ${h}`);
  }
});

test("見出しに似た本文行は打鍵対象のまま残す", () => {
  for (const line of ["第一部が完成した。", "第一章が終わった。", "序の口である。", "一人だった。"]) {
    const d = C.parseAozora(line);
    assert.equal(d.target, line, `本文を見出しと誤判定した: ${line}`);
  }
});

test("打ちようのない記号は文中でも自動入力になる", () => {
  const d = C.parseAozora("あ‡い※う");
  assert.equal(d.target, "あいう");
  assert.equal(autos(d), "‡※");
  assert.ok(tapeText(d).includes("‡"), "記号自体はテープに残る");
});

test("挿絵・外字だけの行はテープからも消える", () => {
  const d = C.parseAozora("前の行。\n挿絵1\n〓\n次の行。");
  assert.equal(d.target, "前の行。次の行。");
  assert.ok(!tapeText(d).includes("挿絵"), "ノイズ行はトークンにも残さない");
  assert.ok(!tapeText(d).includes("〓"));
  assert.equal(autos(d), "\n", "行が消えたぶん改行も1つに詰まる");
});

test("スキップ規則は記法を解いた後に掛かる", () => {
  // ［＃…］が残っていると行全体の照合が効かない
  const d = C.parseAozora("［＃３字下げ］第一章［＃「第一章」は中見出し］\n本文です。");
  assert.equal(d.target, "本文です。");
});

test("スキップ規則はリストに1行足すだけで増やせる", () => {
  assert.ok(Array.isArray(C.NOISE_LINES) && Array.isArray(C.AUTO_LINES));
  for (const re of [...C.NOISE_LINES, ...C.AUTO_LINES]) assert.ok(re instanceof RegExp);
  assert.ok(!C.AUTO_CHARS.global, "文字判定の正規表現は /g だと lastIndex で取りこぼす");
});

test("applySkips: 自動入力の位置は整形後テキストの添字と一致する", () => {
  const { text, auto } = C.applySkips("挿絵1\n第一章\nあ‡い");
  assert.equal(text, "第一章\nあ‡い");
  assert.equal([...auto].join(""), "1110010", "見出し3文字と ‡ だけが立つ");
});

test("スキップした見出しを打たずに先へ進める", () => {
  C.setDoc({ title: "t", author: "", text: "第一章\n吾輩は猫である。" });
  assert.equal(C.state.target, "吾輩は猫である。");
  C.engineReset();
  for (const ch of "吾輩は猫である。") { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  assert.equal(C.state.cursor, 8);
  assert.ok(C.state.typed.every(t => t.cls === "ok"));
  // 描画では見出しが自動入力として先頭に入る
  assert.equal(plain(C.renderRange(0, C.state.typed.length, 0, C.state.cursor).html),
               "第一章\n吾輩は猫である。");
  C.setDoc(C.SAMPLE);
});

// ── 類似記号の統一（issue #4） ──

// テキストを打ち込んで、全文が ok になったかを返す
function typeAll(text, input) {
  C.setDoc({ title: "t", author: "", text });
  C.engineReset();
  for (const ch of C.normalizeInput(input)) { C.step(ch); C.reclassify(); C.maybeAnchor(); }
  const r = { cursor: C.state.cursor, allOk: C.state.typed.every(t => t.cls === "ok"),
              shown: C.state.typed.map(t => t.ch).join("") };
  C.setDoc(C.SAMPLE);
  return r;
}

test("字形の近い記号はどちらで打っても正解になる", () => {
  for (const [tape, typed] of [["あ―い", "あ—い"], ["あ―い", "あ─い"], ["あ…い", "あ⋯い"],
                               ["あ…い", "あ‥い"], ["あ○い", "あ〇い"], ["あ○い", "あ◯い"],
                               ["あ・い", "あ･い"], ["あ〜い", "あ~い"], ["It's", "It’s"]]) {
    const r = typeAll(tape, typed);
    assert.ok(r.allOk, `お手本 ${tape} に対して ${typed} が ng になった`);
    assert.equal(r.cursor, [...tape].length);
  }
});

test("統一は判定だけで、表示は打った字のまま残す", () => {
  const r = typeAll("あ○い", "あ〇い");
  assert.equal(r.shown, "あ〇い", "入力欄で ○ に化けてはいけない");
  // お手本側も原文のまま。テープに出るのは target であって targetKey ではない
  C.setDoc({ title: "t", author: "", text: "あ〇い" });
  assert.equal(C.state.target, "あ〇い");
  assert.equal(C.state.targetKey, "あ○い");
  C.setDoc(C.SAMPLE);
});

test("長音符は横棒に寄せない（コーヒーが壊れる）", () => {
  assert.equal(C.unify("ー"), "ー");
  assert.notEqual(C.unify("―"), "ー");
  assert.ok(!typeAll("コーヒー", "コ―ヒ―").allOk, "長音符とダーシは打ち分ける字");
});

test("統一しても判定用キーの長さは原文と一致する", () => {
  const chars = C.SIMILAR_GROUPS.flatMap(([to, from]) => [to, ...from]);
  for (const c of chars) assert.equal(C.unify(c).length, c.length, `1文字→1文字でない: ${c}`);
  const src = chars.join("") + "吾輩は猫である。";
  assert.equal(C.unifyAll(src).length, src.length);
});

test("統一の対象外はそのまま通す", () => {
  for (const c of ["あ", "国", "　", " ", "A", "1", "。", "、", "ー"]) assert.equal(C.unify(c), c);
});

// ── 括弧の統一（issue #23） ──

test("和文の括弧はどれで打っても正解になる", () => {
  for (const [tape, typed] of [["「あ」", "『あ』"], ["「あ」", "【あ】"], ["「あ」", "〈あ〉"],
                               ["「あ」", "《あ》"], ["『あ』", "「あ」"], ["【あ】", "〈あ〉"]]) {
    const r = typeAll(tape, typed);
    assert.ok(r.allOk, `お手本 ${tape} に対して ${typed} が ng になった`);
    assert.equal(r.cursor, [...tape].length);
  }
});

test("括弧も表示は打った字・原文の字のまま残す", () => {
  // 打ち分けを問わないだけで、『 』を「 」に書き換えてしまってはいけない
  const r = typeAll("「あ」", "『あ』");
  assert.equal(r.shown, "『あ』");
  C.setDoc({ title: "t", author: "", text: "『あ』" });
  assert.equal(C.state.target, "『あ』");
  assert.equal(C.state.targetKey, "「あ」");
  C.setDoc(C.SAMPLE);
});

test("開き括弧と閉じ括弧は混ざらない", () => {
  // 向きまで潰すと、閉じ忘れがそのまま通ってしまう
  assert.equal(C.unify("『"), "「");
  assert.equal(C.unify("』"), "」");
  assert.ok(!typeAll("「あ」", "「あ「").allOk, "閉じ括弧の代わりに開き括弧は打てない");
});

test("統一の規則は代表字と寄せる字の組で持つ", () => {
  assert.ok(Array.isArray(C.SIMILAR_GROUPS));
  const seen = new Map();
  for (const [to, from] of C.SIMILAR_GROUPS) {
    assert.equal(typeof to, "string");
    for (const c of from) {
      assert.ok(!seen.has(c), `${c} が複数の組に入っている（寄せ先が定まらない）`);
      seen.set(c, to);
    }
  }
  // 代表字自身が別の組の変換対象になっていると、寄せ先が2段になって定まらない
  for (const [to] of C.SIMILAR_GROUPS) assert.ok(!seen.has(to), `代表字 ${to} が寄せられている`);
});

// ── ファズ：ランダムな変換単位と誤入力で、自動挿入位置が常に正しいこと ──
function truth(p, pre, T) {
  let s = "";
  for (let u = 0; u <= p; u++) { if (pre[u]) s += pre[u]; if (u < p) s += T[u]; }
  return s;
}

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
