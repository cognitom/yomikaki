// 実機バグから導出した「守らなければ壊れる」不変条件を、コード上で機械的に守らせる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const js = fs.readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf8")
  .match(/<script>([\s\S]*)<\/script>/)[1];

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
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf8");
  assert.ok(/\.editor\{[\s\S]*?letter-spacing:normal/.test(css));
  assert.ok(/\.tape\{[\s\S]*?letter-spacing:normal/.test(css));
});
