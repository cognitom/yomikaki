// ホーム画面から起動しても、通信がなくても打てるようにするための Service Worker。
// 青空文庫の取得（別オリジン）には一切介入しない — 本文は取れないが、
// 収録サンプルでの練習はオフラインでも成立する。
"use strict";

const VERSION = "v1";
const CACHE = "yomikaki-" + VERSION;

// index.html は単一ファイルなので、これだけ揃えばアプリは動く。
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;   // 青空文庫はそのまま通す

  // HTML は network-first。更新が即座に届き、圏外ではキャッシュに落ちる。
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { save(req, res); return res; })
        .catch(async () => (await caches.match(req)) || (await caches.match("./index.html")))
    );
    return;
  }

  // アイコン等は cache-first。
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => { save(req, res); return res; }))
  );
});

function save(req, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy));
}
