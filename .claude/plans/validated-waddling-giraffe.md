# Issue #8: Display Line Numbers in CSV Diff Table

## Context

現在のCSV diffテーブルには行番号がない。レビュー時に特定の行を参照しづらく、どの行が変更されたかを把握するのも困難。行番号列を追加し、元ファイルの**実際の行番号**を表示する。

**重要**: diffがファイル途中の場合（hunkが `@@ -19,31 +19,31 @@` 等）、配列インデックスからの計算では正しい行番号にならない。GitHubのDOMの行番号セルから直接取得する必要がある。

## 変更対象ファイル

1. `src/parser/uiConfig.ts` — `UiConfig` に `extractLineNumber` メソッド追加
2. `src/parser/diffParser.ts` — `DiffLine`/`CsvDiff` 型拡張、行番号抽出、`diffToCsv` 修正
3. `src/renderer/tableRenderer.ts` — `MatchedRow` 型拡張、マッチング関数、描画関数、ハイライト補正
4. `src/styles/diff-table.css` — 行番号列のスタイル

## 実装手順

### 1. `DiffLine` に行番号フィールドを追加 (`diffParser.ts:7-10`)

```typescript
export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  oldLineNumber: number | null;  // null for "added" lines
  newLineNumber: number | null;  // null for "removed" lines
}
```

### 2. `CsvDiff` に行番号配列を追加 (`diffParser.ts:12-15`)

```typescript
export interface CsvDiff {
  before: string[][];
  after: string[][];
  beforeLineNumbers: number[];  // parallel to before[], before[i] → file line beforeLineNumbers[i]
  afterLineNumbers: number[];   // parallel to after[]
}
```

### 3. `UiConfig` に `extractLineNumber` メソッドを追加 (`uiConfig.ts`)

行番号の取得方法がUI種別で異なる（Playwright検証済み）:

| UI | 取得方法 | empty判定 |
|-----|---------|-----------|
| **Preview UI** | `parseInt(cell.textContent.trim(), 10)` | `empty-diff-line` クラス → textContentが空 |
| **Classic UI** | `parseInt(cell.getAttribute("data-line-number"), 10)` | `empty-cell` クラス → `data-line-number` = null |

`UiConfig` インターフェースに追加:
```typescript
extractLineNumber(cell: HTMLTableCellElement): number | null;
```

**PREVIEW_UI実装**:
```typescript
extractLineNumber(cell) {
  const text = cell.textContent?.trim();
  if (!text) return null;
  const num = parseInt(text, 10);
  return Number.isNaN(num) ? null : num;
}
```

**CLASSIC_UI実装**:
```typescript
extractLineNumber(cell) {
  const attr = cell.getAttribute("data-line-number");
  if (attr == null) return null;
  const num = parseInt(attr, 10);
  return Number.isNaN(num) ? null : num;
}
```

### 4. `extractDiffLinesFromDom` で行番号を抽出 (`diffParser.ts:67-175`)

各 `DiffLine` の `push` 時に `ui.extractLineNumber()` で行番号を付与:

**Split layout (4 cells)**: `cells[0]` = old行番号, `cells[2]` = new行番号
- unchanged: `{ ..., oldLineNumber: ui.extractLineNumber(cells[0]), newLineNumber: ui.extractLineNumber(cells[2]) }`
- added (leftEmpty): `{ ..., oldLineNumber: null, newLineNumber: ui.extractLineNumber(cells[2]) }`
- removed (rightEmpty): `{ ..., oldLineNumber: ui.extractLineNumber(cells[0]), newLineNumber: null }`
- modified (both present): removed → `oldLineNumber: ui.extractLineNumber(cells[0])`, added → `newLineNumber: ui.extractLineNumber(cells[2])`

**Unified layout (3 cells)**: `cells[0]` = old行番号, `cells[1]` = new行番号
- unchanged: `{ ..., oldLineNumber: ui.extractLineNumber(cells[0]), newLineNumber: ui.extractLineNumber(cells[1]) }`
- added (oldEmpty): `{ ..., oldLineNumber: null, newLineNumber: ui.extractLineNumber(cells[1]) }`
- removed (newEmpty): `{ ..., oldLineNumber: ui.extractLineNumber(cells[0]), newLineNumber: null }`

### 5. `diffToCsv` で行番号配列を構築 (`diffParser.ts:43-60`)

```typescript
export function diffToCsv(lines: DiffLine[]): CsvDiff {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  const beforeLineNumbers: number[] = [];
  const afterLineNumbers: number[] = [];

  for (const line of lines) {
    if (line.type === "removed" || line.type === "unchanged") {
      beforeLines.push(line.content);
      beforeLineNumbers.push(line.oldLineNumber ?? 0);
    }
    if (line.type === "added" || line.type === "unchanged") {
      afterLines.push(line.content);
      afterLineNumbers.push(line.newLineNumber ?? 0);
    }
  }

  return {
    before: parseCsv(beforeLines.join("\n")),
    after: parseCsv(afterLines.join("\n")),
    beforeLineNumbers,
    afterLineNumbers,
  };
}
```

注: `beforeLineNumbers[i]` は `before[i]` の元ファイル行番号。multi-line CSV値の場合は最初のDiffLineの行番号が使われる（1:1対応を前提、99%のCSVで成立）。

### 6. `MatchedRow` に行番号を追加 (`tableRenderer.ts:11-15`)

```typescript
export interface MatchedRow {
  before: string[] | null;
  after: string[] | null;
  type: "added" | "removed" | "modified" | "unchanged";
  beforeLineNumber: number | null;
  afterLineNumber: number | null;
}
```

### 7. `renderDiffTable` から行番号を伝播 (`tableRenderer.ts:17-60`)

```typescript
const beforeLineNums = diff.beforeLineNumbers.slice(1);  // skip header
const afterLineNums = diff.afterLineNumbers.slice(1);
const matched = matchRows(beforeData, afterData, beforeLineNums, afterLineNums);
```

### 8. `matchByOrder` で行番号を伝播 (`tableRenderer.ts:237-260`)

シグネチャに `beforeLineNums: number[]`, `afterLineNums: number[]` を追加。
`result.push` 時に `beforeLineNumber: beforeLineNums[i] ?? null`, `afterLineNumber: afterLineNums[i] ?? null` を設定。

### 9. `matchByKey` で行番号を伝播 (`tableRenderer.ts:189-235`)

同様にシグネチャ拡張。`for...of` → `for (let bi = 0; ...)` に変更。
- beforeRow match: `beforeLineNumber: beforeLineNums[bi]`
- after match: `afterLineNumber: afterLineNums[ai]`
- after-only flush: `afterLineNumber: afterLineNums[j]`

### 10. `matchRows` シグネチャ更新

```typescript
function matchRows(
  before: string[][],
  after: string[][],
  beforeLineNums: number[],
  afterLineNums: number[],
): MatchedRow[]
```

### 11. `buildSide()` に行番号列を追加 (`tableRenderer.ts:62-120`)

- `<thead>`: 先頭に `<th class="csv-diff-line-num">#</th>` を追加
- `<tbody>`: 各行の先頭に `<td class="csv-diff-line-num">` を追加
  - `lineNum` = `side === "before" ? match.beforeLineNumber : match.afterLineNumber`
  - 表示値: `lineNum != null ? String(lineNum) : "\u00A0"`
  - 空行（プレースホルダー）は `"\u00A0"`

### 12. `highlightChangedCells()` のセルインデックス補正 (`tableRenderer.ts:122-161`)

行番号セルが `children[0]` に入るため、データセルのアクセスを `children[c]` → `children[c + 1]` に変更。

### 13. CSS追加 (`diff-table.css`)

```css
.csv-diff-line-num {
  width: 1px;
  min-width: 32px;
  text-align: right;
  color: var(--fgColor-muted, #636c76);
  user-select: none;
  padding: 2px 6px;
  border-right: 1px solid var(--borderColor-default, #d0d7de);
  font-variant-numeric: tabular-nums;
}

th.csv-diff-line-num {
  padding: 4px 6px;
}

.csv-diff-row-empty .csv-diff-line-num {
  color: transparent;
}
```

行の背景色ハイライトは既存の行クラス（`.csv-diff-row-added` 等）がTRに付与されているため、行番号セルも自動的に継承する。追加のハイライトクラスは不要。

## エッジケース

- **ファイル途中のdiff**: DOMから実際の行番号を取得するため正確に表示される
- **Key-basedマッチングで行が並び替えられた場合**: 行番号が非連続になる（例: 19, 20, 22, 25）→ 正しい動作
- **空行プレースホルダー**: `\u00A0`表示 + `color: transparent` で既存の挙動と一致
- **スクロール同期**: 影響なし（`scrollLeft`ベースで幅非依存）
- **インラインdiffハイライト**: `children[c+1]`補正により正常動作
- **multi-line CSV値**: DiffLineとCSV行の1:1対応を前提。稀なケースで行番号がずれる可能性あるが、実用上問題なし

## 検証方法

1. `npm run build` でビルド成功を確認
2. `npm run lint` でlintパスを確認
3. Chrome拡張としてロードし、以下のPRで確認:
   - **全体diff** (`letconst/github-better-csv-diff#2/changes`): 行番号が1から始まることを確認
   - **部分diff**: 行番号が19等の中間値から始まることを確認
   - Before/After両テーブルの左端に行番号列が表示される
   - 追加行（緑）・削除行（赤）・変更行の行番号セルが行と同じ背景色
   - プレースホルダー行の行番号が非表示
   - インラインdiffハイライトが正常に動作する
   - Preview UI / Classic UI の両方で動作する
