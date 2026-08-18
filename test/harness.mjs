// index.html の //#region testable 〜 //#endregion testable を切り出して読み込む。
// 単一 HTML を維持したままロジックをテストするための仕組み。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");

export async function loadCore() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const m = js.match(/\/\/#region testable([\s\S]*?)\/\/#endregion testable/);
  if (!m) throw new Error("testable region が見つかりません");

  const src = m[1] + `
export { SAMPLE, parseAozora, setDoc, engineReset, step, reclassify, maybeAnchor,
         esc, autoHTML, renderRange, toHalf, normalizeInput,
         applySkips, NOISE_LINES, AUTO_LINES, AUTO_CHARS,
         unify, unifyAll, SIMILAR_GROUPS,
         hashText, workId, storageKey, storageGet, storageSet, storageRemove,
         STORAGE_PREFIX, STORAGE_VERSION,
         resolveResumeCursor, loadBookmark, saveBookmark, clearBookmark };
export const state = {
  get tokens(){return tokens}, get target(){return target},
  get targetKey(){return targetKey},
  get pre(){return pre}, get tokenOfTarget(){return tokenOfTarget},
  get typed(){return typed}, get cursor(){return cursor}, get anchorK(){return anchorK},
  get anchorT(){return anchorT}
};
`;
  // node --test はファイルを並行実行するので、固定名だと呼び出し元どうしで
  // 書き込み・削除が競合する（一方が読む前にもう一方が消す）。呼び出しごとに名前を分ける。
  const tmp = path.join(ROOT, "test", `.core.generated.${crypto.randomUUID()}.mjs`);
  fs.writeFileSync(tmp, src);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.unlinkSync(tmp);
  }
}
