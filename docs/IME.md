# contenteditable と IME の捕捉

[仕様書.md](仕様書.md) の各論。ここに書かれた規則はすべて実機バグから導出したもので、
主要なものは `test/invariants.test.mjs` が機械的に検査する。

## DOM 構造

```html
<div class="editor" contenteditable="true">
  <span class="frozen"  contenteditable="false">…確定済み（凍結）…</span>
  <span class="live"    contenteditable="false">…確定済み（再評価対象）…
    <span class="anchor"></span>            <!-- 幅0・キャレット位置の測定用 -->
  </span>
  <span class="compose">&#8203;</span>       <!-- キャレットの受け皿。常に ZWSP を保持 -->
</div>
```

確定済みを `contenteditable="false"` にすることでキャレットが過去に入り込めない。同一ブロックフロー内なので変換候補ウィンドウが正しい位置に出る（隠し textarea 方式にしなかった最大の理由）。

## 3つの鉄則

**① `composeEl` を空にしてはならない。**
空になるとブラウザが有効なキャレット位置を失い、要素が編集可能とみなされなくなって **IME がデタッチする**。ゼロ幅スペース（ZWSP, U+200B）を常駐させ、確定文字列・直接入力からは ZWSP を除去する。

**② 変換に関わる `inputType` を絶対にブロックしない。**
IME は変換中に `deleteCompositionText` → `insertCompositionText` を発行する。前者を `preventDefault` すると変換が壊れる。`inputType` に `Composition` を含むものは無条件に通す。

**③ 確定処理を `setTimeout` で遅延させてはならない。**
`compositionend` の直後に次の変換が始まりうる（Enter を押さずに次の文を打ち始める操作は自然に起きる）。`setTimeout(0)` は次のタスクなのでキー入力に追い越され、`clearPending()` が新しい未確定文字列を破壊する。`queueMicrotask` なら現在のタスク直後＝次のキーイベントより確実に前に走る。

## イベント

| イベント | 処理 |
|---|---|
| `compositionstart` | 変換中フラグ。テープの更新を停止 |
| `compositionupdate` | スクロールのみ追従（DOM は触らない） |
| `compositionend` | `event.data` から ZWSP を除いて確定文字列とし、`queueMicrotask` で確定処理 |
| `input` | `isComposing === false` かつ確定直後 80ms のガード外のときだけ直接入力として処理 |
| `beforeinput` | `Composition` 系は通す。それ以外の `delete*` / `insertParagraph` / `insertLineBreak` / `insertFrom*` / `history*` / `format*` を `preventDefault` |
| `keydown` | 打鍵カウント。キャレットが `composeEl` の外にあればキー処理前に引き戻す |
| `selectionchange` | キャレットが `composeEl` の外なら押し戻す |

### 変換中の制約

- DOM を触らない
- キャレットを動かさない（`placeCaret` は `composing` でガード）
- テープの `translateX` を更新しない（未確定文字列でキャレットだけが右へ動くため）

### キャレット復帰の3層構造

1. **原因の除去** … ZWSP 常駐
2. **キー処理前の復帰** … `keydown` 時に検査
3. **最終防衛線** … 500ms 間隔で検査し自動復帰（発動時はログに `heal` を残す）

## 打鍵カウントの実機事情

- IME 経由のキーは `key` が Android で `"Unidentified"`、Windows で `"Process"` になる。実打鍵なので必ず数える。除外するのは `Control` / `Alt` / `Meta` / `CapsLock` / `AltGraph` / `ContextMenu` のみ。
- Shift はかな入力の小書き文字・記号・括弧で実際に使うため、打鍵に含める。
- Space / Enter / 矢印の内訳は `key` が潰れるため取得できない（仕様書の統計の節を参照）。

## 診断ログ

イベントログを常時記録する（300件リングバッファ）。`keydown` / `composition*` / `beforeinput` / `input` の種別とデータ、`COMMIT` の確定文字列と cursor 移動、`heal` の発動を記録し、readonly な textarea に出す（全選択・コピー可）。

エディタ核の実装で出たバグはすべてこのログから特定した。特に「JIS配列で『わ』は0キー」という事実から、`key: "0"` が届いた時点で IME がデタッチしていると判断できたのが決定的だった。実機の IME 挙動は机上で予測できないため、この機能は今後も残す。
