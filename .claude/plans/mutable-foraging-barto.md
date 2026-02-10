# CSS テーマ変数の修正（GitHub テーマ互換性）

## 背景

拡張機能の CSV 差分テーブルが、ユーザーの GitHub テーマ設定に関係なく常にライトテーマの色で表示されていた。原因は、拡張機能が使用している CSS 変数名が GitHub の実際の変数名と **一致していない** ため、`var()` のフォールバック値（ライトテーマ用のハードコード色）が常に使われていたこと。加えて、テキストの前景色（`color`）が未設定で、背景色と継承テキスト色の組み合わせによりテキストが読みにくくなっていた。

## 根本原因

GitHub は `--diffBlob-additionLine-bgColor`（camelCase 複合語）を使用しているが、拡張機能は `--diffBlob-addition-bgColor-line`（kebab 区切り）を使用していた。後者は GitHub の CSS に存在しない命名規則。

## 変更ファイル

`src/styles/diff-table.css` — CSS のみの修正。TypeScript の変更は不要。

## 変更内容

### 1. `.csv-diff-container` にテキスト色を追加

```css
color: var(--fgColor-default, #1f2328);
```

テーブル全体のテキストがテーマに応じた正しい前景色を継承するようにする。

### 2. 4つの誤った CSS 変数名を修正 + 前景色を追加

| セレクタ | 旧変数（誤） | 新変数（正） |
|---|---|---|
| `.csv-diff-row-added` | `--diffBlob-addition-bgColor-line` | `--diffBlob-additionLine-bgColor` |
| `.csv-diff-row-removed` | `--diffBlob-deletion-bgColor-line` | `--diffBlob-deletionLine-bgColor` |
| `.csv-diff-cell-changed` | `--diffBlob-addition-bgColor-word` | `--diffBlob-additionLine-bgColor` |
| `.csv-diff-cell-removed` | `--diffBlob-deletion-bgColor-word` | `--diffBlob-deletionLine-bgColor` |

補足: `.csv-diff-cell-changed` / `.csv-diff-cell-removed` は当初 Word 変数（`--diffBlob-additionWord-bgColor`）を使う予定だったが、GitHub 上で Word 変数は文字レベルのインライン背景に使われるものであり、テーブルセル全体の背景には不適切と判断。Line 変数に統一した。

各セレクタに対応する `fgColor` 変数で `color` プロパティを追加:
- `.csv-diff-row-added`: `color: var(--diffBlob-additionLine-fgColor, #1f2328);`
- `.csv-diff-row-removed`: `color: var(--diffBlob-deletionLine-fgColor, #1f2328);`
- `.csv-diff-cell-changed`: `color: var(--diffBlob-additionLine-fgColor, #1f2328);`
- `.csv-diff-cell-removed`: `color: var(--diffBlob-deletionLine-fgColor, #1f2328);`

### 3. `.csv-diff-row-empty` に diff 専用の空行変数を使用

```css
background: var(--diffBlob-emptyLine-bgColor, var(--bgColor-muted, #f6f8fa));
```

### 変更しないもの

- CSS クラス名（TypeScript の変更なし）
- 背景色のフォールバック値（#dafbe1, #ffebe9 等）— ライトテーマ用として正しい
- ボーダー/ヘッダー/レイアウト変数（`--borderColor-default`, `--bgColor-muted`）— 既に正しい
- マニフェストおよびビルド設定

## 検証方法

1. `npm run build`
2. `dist/` を unpacked extension として読み込み
3. https://github.com/letconst/github-better-csv-diff/pull/2/changes を開く
4. GitHub テーマ（Settings > Appearance）を切り替えて確認:
   - 差分行の背景色が各テーマのネイティブ差分色と一致すること
   - すべての背景色上でテキストが読みやすいこと
   - 空行がページ背景に馴染むこと
