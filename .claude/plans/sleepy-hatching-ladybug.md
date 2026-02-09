# Implementation Plan: CSV Diff Core Features

## Context

Chrome extension "GitHub Better CSV Diff" のセットアップは完了しているが、主要機能4つ（Diffパーサー、DOM Observer、テーブルレンダラー、テーブル注入）が未実装のスタブ状態。これらを実装し、GitHub PR "Files changed" タブでCSVファイルのdiffをside-by-sideテーブルとして表示できるようにする。

## 実装済みモジュール（変更不要）

- `src/content/index.ts` — エントリポイント（CSS import + observer呼び出し）
- `src/parser/csvParser.ts` — PapaParse wrapper: `parseCsv(raw): string[][]`
- `src/styles/diff-table.css` — 完成済みCSS（GitHub theme vars対応）

---

## GitHub DOM構造（実機調査結果 2026-02-08、Split Layout）

> **対応範囲**: 今回は Split Layout（side-by-side表示）のみ対応。Unified Layout は将来対応予定。

### ファイルコンテナ
```
div[id^="diff-"][role="region"]   ← ファイルdiffコンテナ（4 CSV files確認）
  ├── div.Diff-module__diffHeaderWrapper__*   ← ファイルヘッダ
  │     └── h3 > link > code   ← ファイル名（例: "csv/event_season_trees.csv"）
  │     └── button("Expand file" / "Collapse file")
  └── div.border.position-relative.rounded-bottom-2   ← diffボディ
        └── table[role="grid"][aria-label="Diff for: xxx.csv"]   ← diffテーブル
```

**注意**: `data-tagsearch-path`, `.file`, `.file-header`, `.blob-code-*` は存在しない（旧DOM）

### セレクタ
- ファイルコンテナ: `div[id^="diff-"][role="region"]`
- ファイル名取得: コンテナ内の `h3` の `textContent`（不可視文字あり、要trim）
- diffテーブル: `table[role="grid"][aria-label^="Diff for:"]`
- ファイルヘッダ: コンテナの `.children[0]`（CSS moduleクラスのため安定セレクタなし）
- diffボディ: コンテナの `.children[1]`（`border rounded-bottom-2` クラス）

### diff行の構造 — Split Layout（4カラム: 旧行番号, 旧コンテンツ, 新行番号, 新コンテンツ）

| 行タイプ | cells[0] (旧行番) | cells[1] (旧コンテンツ) | cells[2] (新行番) | cells[3] (新コンテンツ) |
|---|---|---|---|---|
| **Hunk header** | colspan全体 `diff-hunk-cell` | — | — | — |
| **Context** | 行番号 + `diff-line-number-neutral` | テキスト（プレフィックスなし）`left-side-diff-cell` | 行番号 + `diff-line-number-neutral` | テキスト（プレフィックスなし）`right-side-diff-cell` |
| **Modified** | 行番号（neutralなし） | `-`プレフィックス + テキスト `left-side-diff-cell` | 行番号（neutralなし） | `+`プレフィックス + テキスト `right-side-diff-cell` |
| **Added** | `empty-diff-line` | `empty-diff-line` | 行番号 | `+`プレフィックス + テキスト `right-side-diff-cell` |
| **Removed** | 行番号 | `-`プレフィックス + テキスト `left-side-diff-cell` | `empty-diff-line` | `empty-diff-line` |

### 折りたたみ状態
- 折りたたまれたファイルは `table` 要素がDOMに存在しない
- 展開時にMutationObserverが検知

---

## Step 1: Diff Parser (`src/parser/diffParser.ts`)

既存の型定義 `DiffLine`, `CsvDiff` はそのまま活用。

### 1a. `parseUnifiedDiff(diffText: string): DiffLine[]`
- 行ごとに分割し、先頭文字で分類:
  - `+`（`+++`除く）→ `added`、`-`（`---`除く）→ `removed`、` `（スペース）→ `unchanged`
  - `@@`, `---`, `+++`, `\` で始まる行はスキップ

### 1b. `diffToCsv(lines: DiffLine[]): CsvDiff`
- `removed` + `unchanged` の content を結合 → `parseCsv()` → `before`
- `added` + `unchanged` の content を結合 → `parseCsv()` → `after`

### 1c. 新規: `extractDiffLinesFromDom(container: HTMLElement): DiffLine[]`
- GitHub DOMから直接diff行を抽出
- `table[role="grid"]` 内の `tr.diff-line-row` を走査
- 各行の判定ロジック:
  1. **Hunk header**: cells[0] に `diff-hunk-cell` クラス → スキップ
  2. **Context行**: cells[0] に `diff-line-number-neutral` → `{ type: "unchanged", content: cells[1].textContent }`
  3. **Added行**: cells[0] に `empty-diff-line` → `{ type: "added", content: stripPlus(cells[3].textContent) }`
  4. **Removed行**: cells[2] に `empty-diff-line` → `{ type: "removed", content: stripMinus(cells[1].textContent) }`
  5. **Modified行**: 上記いずれでもない → 2つの DiffLine を出力:
     - `{ type: "removed", content: stripMinus(cells[1].textContent) }`
     - `{ type: "added", content: stripPlus(cells[3].textContent) }`
- `+`/`-` プレフィックスは `textContent` の先頭1文字を除去

---

## Step 2: Table Renderer (`src/renderer/tableRenderer.ts`)

### 2a. `renderDiffTable(diff: CsvDiff): HTMLElement`
- `diff.before[0]` / `diff.after[0]` をヘッダ行として使用
- `matchRows(before.slice(1), after.slice(1))` で行マッチング
- Side-by-side HTML構造:
  ```
  div.csv-diff-container
    div.csv-diff-side  → "Before" ヘッダ + table
    div.csv-diff-side  → "After" ヘッダ + table
  ```
- 行タイプに応じたCSSクラス付与:
  - `added` → after側 `.csv-diff-row-added`、before側は空行
  - `removed` → before側 `.csv-diff-row-removed`、after側は空行
  - `modified` → セル単位で比較、変更セルに `.csv-diff-cell-changed` / `.csv-diff-cell-removed`

### 2b. 新規: `matchRows(before: string[][], after: string[][]): MatchedRow[]`

**型定義:**
```typescript
interface MatchedRow {
  before: string[] | null;
  after: string[] | null;
  type: "added" | "removed" | "modified" | "unchanged";
}
```

**アルゴリズム（2段階）:**

1. **第1列キー判定**: 両サイドの第1列値がユニークかつ30%以上重複 → キーベース
2. **キーベースマッチング**: after順に走査、beforeMapから対応行を取得。未マッチのbefore行は `removed` として末尾追加
3. **フォールバック（行順マッチング）**: インデックス順に対応付け。長い方に合わせてnull埋め

---

## Step 3: DOM Observer (`src/content/observer.ts`)

### 3a. `observeDiffContainers(): void`
```
1. processExistingDiffs() で初回スキャン
2. MutationObserver(document.body, { childList: true, subtree: true })
   → debounce(300ms) → processExistingDiffs()
3. turbo:load / pjax:end イベントリスナーも登録（SPA対応バックアップ）
```

### 3b. `processExistingDiffs(): void`
- `document.querySelectorAll('div[id^="diff-"][role="region"]')` でファイルコンテナ取得
- ファイル名取得: コンテナ内 `h3` の `textContent.trim()`
  - 不可視文字（LRI/RLI Unicode markers）を除去してから `.csv` / `.tsv` 判定
- テーブル存在チェック: `container.querySelector('table[role="grid"]')` — 無ければスキップ（折りたたみ中）
- `data-csv-diff-processed` 属性で二重処理防止
- 該当コンテナに対して `processCsvDiffBlock()` 呼び出し

### 3c. `processCsvDiffBlock(container: HTMLElement): void`
```
extractDiffLinesFromDom(container) → DiffLine[]
  → diffToCsv(lines) → CsvDiff
    → renderDiffTable(csvDiff) → HTMLElement
      → injectTableOverlay(container, table)
```

### 3d. `injectTableOverlay(container: HTMLElement, table: HTMLElement): void`
- ファイルヘッダ: `container.children[0]`（CSS moduleクラスなので固定セレクタが使えない）
  - ヘッダ内のボタン群エリアにトグルボタンを追加
  - GitHubの `btn btn-sm` クラスを利用（統一感のあるスタイル）
- diffボディ: `container.children[1]`（`table[role="grid"]`の親要素）
- テーブルをdiffボディの前に挿入（**デフォルトでテーブルビュー表示**、元diffは非表示）
- トグルクリックでdiffボディとテーブルの表示を切り替え

**ヘルパー:**
- `debounce(fn, delayMs)` — MutationObserver用

---

## Step 4: CSS追加 (`src/styles/diff-table.css`)

以下を追加:
```css
.csv-diff-toggle-btn { margin-left: 8px; cursor: pointer; }
.csv-diff-toggle-active { font-weight: 600; }
.csv-diff-wrapper { padding: 8px; }
.csv-diff-row-empty { background: var(--bgColor-muted, #f6f8fa); }
.csv-diff-row-empty td { color: transparent; user-select: none; }
```

---

## 実装順序

1. **`src/parser/diffParser.ts`** — 他モジュールへの依存なし、基盤
2. **`src/renderer/tableRenderer.ts`** — diffParser の型のみ依存
3. **`src/styles/diff-table.css`** — トグル・空行用CSS追加
4. **`src/content/observer.ts`** — 全モジュール統合、最後に実装

---

## 検証方法

1. `npm run build` でビルド成功を確認
2. `dist/` を Chrome に unpacked extension としてロード
3. CSVファイルを含むPRの "Files changed" タブを開く
4. トグルボタンが表示され、クリックでside-by-sideテーブルに切り替わることを確認
5. 追加行（緑）、削除行（赤）、変更セルのハイライトを確認

---

## セキュリティ要件（MV3 Best Practices）

- **XSS防止**: レンダラーで `innerHTML` は一切使わない。すべて `document.createElement()` + `textContent` で構築
- **CSP準拠**: インラインスクリプト・インラインイベントハンドラ不使用（`addEventListener` のみ）
- **入力検証**: CSV データは外部ソース（GitHub DOM）から取得するため、空値・異常値への耐性を持たせる

## エラーハンドリング

- `processCsvDiffBlock()` を `try-catch` で囲み、1つのdiffブロックのエラーが他に波及しないようにする
- エラー時は `console.error` で詳細ログを出力し、該当ブロックをスキップ
- DOM要素が見つからない場合（GitHub DOM変更）は `console.warn` で警告し、graceful degradation

## パフォーマンス

- DOM要素の一括挿入には `DocumentFragment` を使用し、リフロー回数を最小化
- MutationObserver のコールバックは `debounce(300ms)` で制御

## 注意点・エッジケース

- **GitHub DOM変更リスク**: CSSモジュールクラス（ハッシュ付き）は使わない。`role`, `aria-label`, `id^="diff-"` 等の安定属性でセレクト
- **折りたたまれたdiff**: テーブルがDOMに存在しないためスキップ。展開時にMutationObserverが検知して処理
- **遅延ロードdiff**: MutationObserverが "Load diff" ボタンクリック後の追加コンテンツもキャッチ
- **大規模CSV**: GitHub側でtruncateされたdiffはそのまま表示（見えている部分のみ処理）
- **CSVの改行含むクォートフィールド**: PapaParse が正しく処理（結合後のテキストとして渡すため）
- **TSVファイル**: PapaParse の自動区切り検出で対応
- **ファイル名の不可視文字**: `h3.textContent` にUnicode方向制御文字が含まれるため、正規表現で除去してから拡張子チェック
- **Unified Layout未対応**: 今回はSplit Layout（4カラム構造）のみ対応。Unified Layout（2カラム構造）は将来対応予定

---

# UI改善: 縦線追加 + 同期スクロール

## Context

上記Step 1〜4の実装は完了済み。以下2点のUI改善を追加実装する:
1. テーブルの列間に縦線（垂直ボーダー）がない → 列の区切りが分かりにくい
2. Before/After を横スクロールしたとき同期しない → 比較が面倒

## 変更1: 縦線の追加

**ファイル**: `src/styles/diff-table.css`

`.csv-diff-side td` と `.csv-diff-side th` に `border-right` を追加。最後の列は `:last-child` で除外。

```css
.csv-diff-side td,
.csv-diff-side th {
  border-right: 1px solid var(--borderColor-muted, #eaeef2);
}

.csv-diff-side td:last-child,
.csv-diff-side th:last-child {
  border-right: none;
}
```

## 変更2: 同期スクロール

**ファイル**: `src/renderer/tableRenderer.ts` — `renderDiffTable` 関数末尾（`highlightChangedCells` の後）に追加

`.csv-diff-side` は `overflow-x: auto` でスクロールコンテナ。2つのside要素にscrollイベントリスナーを追加し、`scrollLeft` を同期。再帰呼び出し防止にフラグ使用。

```typescript
const sides = container.querySelectorAll<HTMLElement>(".csv-diff-side");
if (sides.length === 2) {
  let syncing = false;
  for (const side of sides) {
    side.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      const other = side === sides[0] ? sides[1] : sides[0];
      other.scrollLeft = side.scrollLeft;
      syncing = false;
    });
  }
}
```

## 検証方法

1. `npm run build` でビルド成功を確認
2. Chrome拡張を再読み込みし、CSVを含むPRページを確認
3. 列間に縦線が表示されていること
4. 片方のテーブルを横スクロールすると、もう片方も追従すること
