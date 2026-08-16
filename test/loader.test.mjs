import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf8");

test("Shift_JIS デコードが利用できる", () => {
  const buf = Buffer.from([0x90,0x56,0x8e,0x9a,0x90,0x56,0x89,0xbc,0x96,0xbc]);
  assert.equal(new TextDecoder("shift_jis").decode(buf), "新字新仮名");
});

test("カードページから本文XHTMLへのリンクを抽出できる", () => {
  const re = new RegExp(html.match(/const m=card\.match\((\/.*?\/)\);/)[1].slice(1, -1));
  assert.equal('<a href="./files/789_14547.html">'.match(re)[1], "files/789_14547.html");
  assert.equal('<a href="files/127_15260.html">'.match(re)[1], "files/127_15260.html");
});

test("カードURLから人物IDと作品IDを取り出せる", () => {
  const re = new RegExp(html.match(/const m=v\.match\((\/.*?\/)\);/)[1].slice(1, -1));
  const m = "https://www.aozora.gr.jp/cards/000148/card789.html".match(re);
  assert.deepEqual([m[1], m[2]], ["000148", "789"]);
  assert.equal("https://example.com/nope".match(re), null);
});
