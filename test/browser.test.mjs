// file:// では確認できないもの（Service Worker の登録・manifest の読み込み）を
// 実ブラウザで検証する。polar のコンテナには Playwright の chromium が同梱されて
// いるが、それ以外の環境（CI 等）には無いことがあるため、無ければ静かに skip する。
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer, PORT } from "../serve.mjs";

test("http:// で開くと Service Worker が activated まで進み、manifest も取得できる（file:// との差）", async t => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    t.skip("playwright の chromium が見つからない（polar のコンテナ内でのみ実行）");
    return;
  }

  const server = createServer();
  await new Promise(resolve => server.listen(PORT, resolve));
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);

    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const worker = reg.active;
      if (worker.state === "activated") return worker.state;
      return new Promise(resolve => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve(worker.state);
        });
      });
    });
    assert.equal(swState, "activated");

    const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
    const manifestRes = await page.request.get(new URL(manifestHref, page.url()).href);
    assert.equal(manifestRes.status(), 200);
    assert.equal(manifestRes.headers()["content-type"], "application/manifest+json; charset=utf-8");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
