// file:// では確認できないもの（Service Worker 登録・manifest 読み込み・fetch の
// 挙動）をブラウザで確認するための最小限の静的サーバー。依存を増やさないため
// node:http だけで書く。ポートは固定: README の「開発」を参照。
import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
export const PORT = 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

export function createServer() {
  return createHttpServer(async (req, res) => {
    let path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
      const body = await readFile(path);
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not Found");
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, () => console.log(`http://localhost:${PORT}/`));
}
