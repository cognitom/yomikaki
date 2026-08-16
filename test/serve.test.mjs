// 確認用サーバの不変条件。http:// で開けることが PWA 確認の前提になっている。
// ポート番号が README に書かれていることまで検査する（次の作業者が探さずに済むように）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer, PORT } from "../scripts/serve.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// ポート衝突を避けるため、テストでは空きポートを使う。
async function withServer(fn) {
  const server = createServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();                  // keep-alive の待ちでテストを止めない
    await new Promise(done => server.close(done));
  }
}

test("ルートを開くと index.html が出る", () => withServer(async base => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  assert.equal(await res.text(), fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
}));

test("Service Worker と manifest が正しい Content-Type で出る", () => withServer(async base => {
  const sw = await fetch(base + "/sw.js");
  assert.equal(sw.status, 200);
  // text/javascript 以外だとブラウザが Service Worker の登録を拒む
  assert.match(sw.headers.get("content-type"), /^text\/javascript/);

  const mf = await fetch(base + "/manifest.webmanifest");
  assert.equal(mf.status, 200);
  assert.match(mf.headers.get("content-type"), /^application\/manifest\+json/);
  assert.ok(JSON.parse(await mf.text()).name);

  const icon = await fetch(base + "/icons/icon-192.png");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
}));

test("常に最新を返す（確認中の編集が反映されるため）", () => withServer(async base => {
  const res = await fetch(base + "/index.html");
  assert.equal(res.headers.get("cache-control"), "no-store");
}));

test("リポジトリの外は出さない", () => withServer(async base => {
  // fetch に潰されないよう、`..` はエンコードしたまま投げる
  for (const p of ["/..%2f..%2fetc%2fpasswd", "/docs/%2e%2e/%2e%2e/%2e%2e/etc/passwd"]) {
    assert.equal((await fetch(base + p)).status, 404, `外に出ている: ${p}`);
  }
  // 遡りはルートで止まる（外に出るのではなく、リポジトリ内のファイルに丸められる）
  const clamped = await fetch(base + "/%2e%2e/package.json");
  assert.equal(clamped.status, 200);
  assert.equal(await clamped.text(), fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}));

test("ディレクトリ一覧と存在しないパスは 404", () => withServer(async base => {
  assert.equal((await fetch(base + "/icons/")).status, 404);
  assert.equal((await fetch(base + "/nope.html")).status, 404);
}));

test("GET / HEAD 以外は受けない", () => withServer(async base => {
  const res = await fetch(base + "/", { method: "POST" });
  assert.equal(res.status, 405);
}));

test("固定ポートが README に書いてある", () => {
  assert.equal(typeof PORT, "number");
  assert.match(fs.readFileSync(path.join(ROOT, "README.md"), "utf8"), new RegExp(`localhost:${PORT}`));
});
