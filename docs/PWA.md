# PWA（ホーム画面へのインストール）

[仕様書.md](仕様書.md) の各論。単一 HTML の原則は崩さない。`index.html` は `file://` でも単体で動いたまま、PWA に必要な最小限のファイルだけを外に置く。

```
manifest.webmanifest   名前・アイコン・standalone 表示
sw.js                  アプリシェルの先読み
icons/                 192 / 512 / maskable 512 / apple-touch 180
```

## 規則

- **パスはすべて相対で書く。** GitHub Pages ではサブパス（`/yomikaki/`）配下に置かれるため、絶対パスが一つ混ざるだけで scope もインストールも壊れる。`test/pwa.test.mjs` が機械的に検査する。
- **Service Worker は同一オリジンの GET しか触らない。** 青空文庫の取得（`raw.githubusercontent.com`）に介入すると CORS と Shift_JIS デコードの経路を壊しかねないので素通しする。
- HTML は network-first（更新が即座に届く）、アイコン等は cache-first。キャッシュ名にバージョンを持たせ、`activate` で古い世代を消す。
- オフラインでも起動でき、収録サンプルは打てる。本文の取得だけは通信が要る。
- `file://` では Service Worker を登録しない（そもそも登録できない）。

## 動作確認

`file://` では PWA まわりが丸ごと確認できない。Service Worker が登録できず、
`manifest.webmanifest` も読まれず、ページ内 fetch のオリジンも本番と違う。

```sh
npm run serve   # → http://localhost:8765/
```

`http://localhost` は secure context として扱われるため、HTTPS を用意しなくても
登録・キャッシュ・オフライン起動まで本番と同じ条件で確認できる。サーバは node
標準ライブラリだけの `scripts/serve.mjs`（依存なし・ポート固定）。`test/serve.test.mjs`
がルートで `index.html` が出ること、`sw.js` と manifest の Content-Type、
ポート番号が README に書かれていることを検査する。

## 表示領域（standalone）

ホーム画面から起動するとブラウザ UI が消え、ヘッダとテープがノッチ／ホームインジケータと重なる。`viewport-fit=cover` を指定し、`env(safe-area-inset-*)` を CSS 変数 `--safeT/B/L/R` に受けて、ヘッダの上端パディング、テープの高さ、入力欄の下端、テープキャレットの `bottom` に加算する。

字送りの計算（`leftInTape` / `caretX`）は実測ベースなので、この加算の影響を受けない。

## インストール導線

- Chromium 系 — `beforeinstallprompt` を捕まえてヘッダに「ホーム画面へ」を出し、クリックで `prompt()`。
- iOS Safari — `beforeinstallprompt` がない。`"standalone" in navigator` で判別し、同じボタンから「共有 → ホーム画面に追加」を案内する。
