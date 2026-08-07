// PWA まわりの不変条件。ホーム画面から起動できる状態を機械的に守らせる。
// GitHub Pages ではサブパス（/yomikaki/）配下に置かれるため、絶対パスを一つでも
// 混ぜるとインストールも Service Worker の scope も壊れる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("index.html");
const manifest = JSON.parse(read("manifest.webmanifest"));
const sw = read("sw.js");

// PNG の IHDR から実寸を読む（依存を増やさないため）
function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${file} は PNG ではない`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("manifest がインストール要件を満たす", () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.start_url && manifest.scope);
  assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
  for (const size of ["192x192", "512x512"]) {
    assert.ok(
      manifest.icons.some(i => i.sizes === size && (i.purpose ?? "any").includes("any")),
      `${size} の any アイコンが必要`
    );
  }
  assert.ok(
    manifest.icons.some(i => (i.purpose ?? "").includes("maskable")),
    "Android のアイコン切り抜きに耐えるため maskable が必要"
  );
});

test("manifest のアイコンが実在し、宣言サイズと一致する", () => {
  for (const icon of manifest.icons) {
    const { w, h } = pngSize(icon.src);
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} の実寸が宣言と違う`);
  }
});

test("manifest 内のパスはすべて相対（サブパス配信のため）", () => {
  for (const v of [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map(i => i.src)]) {
    assert.doesNotMatch(v, /^(\/|https?:)/, `絶対パスは使えない: ${v}`);
  }
});

test("index.html が manifest とアイコンを相対パスで参照する", () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="theme-color" content="#E7E9E0">/);
  assert.ok(fs.existsSync(path.join(ROOT, "icons/apple-touch-icon.png")));
  // iOS のホーム画面起動でノッチ下に潜らせないため viewport-fit が要る
  assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/);
});

test("Service Worker を相対パスで登録し、file:// では登録しない", () => {
  assert.match(html, /navigator\.serviceWorker\.register\("sw\.js"/);
  assert.match(html, /location\.protocol\.startsWith\("http"\)/);
});

test("Service Worker が先読みするファイルはすべて実在する", () => {
  const list = sw.match(/const SHELL = \[([\s\S]*?)\]/)[1]
    .match(/"([^"]+)"/g).map(s => s.slice(1, -1));
  for (const p of list) {
    assert.match(p, /^\.\//, `SHELL は相対パスで書く: ${p}`);
    if (p === "./") continue;                       // index.html と同じもの
    assert.ok(fs.existsSync(path.join(ROOT, p)), `存在しないファイルを先読みしている: ${p}`);
  }
  assert.ok(list.includes("./index.html"));
});

test("Service Worker は別オリジン（青空文庫）に介入しない", () => {
  assert.match(sw, /origin !== self\.location\.origin\) return/);
});

test("キャッシュ名にバージョンが入り、古い世代を消す", () => {
  assert.match(sw, /const VERSION = "v\d+"/);
  assert.match(sw, /caches\.delete/);
});
