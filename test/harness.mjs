// index.html の //#region testable 〜 //#endregion testable を切り出して読み込む。
// 単一 HTML を維持したままロジックをテストするための仕組み。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

export async function loadCore() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const m = js.match(/\/\/#region testable([\s\S]*?)\/\/#endregion testable/);
  if (!m) throw new Error("testable region が見つかりません");

  const src = m[1] + `
export { SAMPLE, parseAozora, setDoc, engineReset, step, reclassify, maybeAnchor,
         esc, autoHTML, renderRange };
export const state = {
  get tokens(){return tokens}, get target(){return target},
  get pre(){return pre}, get tokenOfTarget(){return tokenOfTarget},
  get typed(){return typed}, get cursor(){return cursor}, get anchorK(){return anchorK}
};
`;
  const tmp = path.join(ROOT, "test", ".core.generated.mjs");
  fs.writeFileSync(tmp, src);
  const mod = await import(pathToFileURL(tmp).href + "?t=" + Date.now());
  fs.unlinkSync(tmp);
  return mod;
}
