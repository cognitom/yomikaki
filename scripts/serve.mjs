#!/usr/bin/env node
// ブラウザでの動作確認を http:// で行うための静的サーバ。
//
// file:// では本番と挙動が違う。Service Worker が登録できず（sw.js が丸ごと未確認になる）、
// manifest.webmanifest も読まれず、ページ内 fetch のオリジンも違う。
// http://localhost は secure context として扱われるので、これを立てるだけで差が消える。
//
// 依存は増やさない（node 標準のみ）。ポートは固定（README 参照）。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// 固定ポート。変えると README と test/serve.test.mjs も直すこと。
export const PORT = 8765;

const ROOT = path.resolve(import.meta.dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
};

// URL のパスをリポジトリ内の実ファイルに解決する。外に出るものは null。
function resolveFile(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;                                   // 壊れたパーセントエンコード
  }
  if (pathname.includes("\0")) return null;

  const full = path.resolve(ROOT, "." + path.posix.normalize(pathname));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;   // ルート外は出さない

  let st;
  try { st = fs.statSync(full); } catch { return null; }
  if (st.isDirectory()) {
    const index = path.join(full, "index.html");
    return fs.existsSync(index) ? index : null;    // ディレクトリ一覧は出さない
  }
  return st.isFile() ? full : null;
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "allow": "GET, HEAD", "content-type": TYPES[".txt"] });
      res.end("405 Method Not Allowed\n");
      return;
    }

    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404, { "content-type": TYPES[".txt"] });
      res.end("404 Not Found\n");
      return;
    }

    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": fs.statSync(file).size,
      // 確認用なので常に最新を返す。Service Worker 自身の更新も止めない。
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

// 直接起動されたときだけ待ち受ける（テストからは createServer() を使う）。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const server = createServer();
  server.on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.error(`ポート ${PORT} は使用中。既に立っているならそのまま開けばよい。`);
      process.exit(1);
    }
    throw err;
  });
  // ホストを指定せず待ち受ける（IPv4 / IPv6 の localhost がどちらも届く）。
  server.listen(PORT, () => console.log(`http://localhost:${PORT}/`));
}
