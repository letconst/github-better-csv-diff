# Plan: Unified Layout 対応

## Context

現在、拡張機能はpreview UIのsplit layout（4セル/行）のみに対応している。unified layout（3セル/行）のCSV diffも同じテーブルビューで表示できるようにする。

Playwrightで実際のDOM構造を調査済み。unified layoutの構造は以下の通り:

| Row Type | cells[0] | cells[1] | cells[2] |
|----------|----------|----------|----------|
| Hunk | `diff-hunk-cell` (1 cell only) | — | — |
| Unchanged | old line num (`diff-line-number-neutral`) | new line num (`diff-line-number-neutral`) | content (no prefix) |
| Removed | old line num | `empty-diff-line` | content (prefix `-`) |
| Added | `empty-diff-line` | new line num | content (prefix `+`) |

## Approach

**変更ファイル: `src/parser/diffParser.ts` のみ**

`extractDiffLinesFromDom()` 関数を修正して、split/unified両方のレイアウトを処理できるようにする。他のファイル（observer、renderer、CSS）は変更不要。

### 具体的な変更

1. **レイアウト検出**: 最初の非hunkデータ行のセル数で判定（4=split, 3=unified）
2. **セル数ガード更新**: `cells.length < 4` → `cells.length < expectedCells`（3 or 4）
3. **unified layout分岐追加**: ループ内で `isUnifiedLayout` の場合の解析ロジックを追加
   - `cells[0]` に `diff-line-number-neutral` → unchanged
   - `cells[0]` に `empty-diff-line` → added（old側が空）
   - `cells[1]` に `empty-diff-line` → removed（new側が空）
   - content は `cells[2]` から取得、既存の `stripPrefix()` で prefix 除去
4. unified layoutでは modified が独立した removed + added 行として来るので、特別な処理不要

### 完成後の関数

```typescript
export function extractDiffLinesFromDom(container: HTMLElement): DiffLine[] {
  const table = container.querySelector<HTMLTableElement>('table[role="grid"]');
  if (!table) {
    console.warn("[GitHub Better CSV Diff] No diff table found in container");
    return [];
  }

  const rows = table.querySelectorAll<HTMLTableRowElement>("tr.diff-line-row");
  const result: DiffLine[] = [];

  // Detect layout: first non-hunk data row cell count
  let isUnifiedLayout = false;
  for (const row of rows) {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    if (cells.length === 0) continue;
    if (cells[0].classList.contains("diff-hunk-cell")) continue;
    isUnifiedLayout = cells.length === 3;
    break;
  }

  const expectedCells = isUnifiedLayout ? 3 : 4;

  for (const row of rows) {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    if (cells.length === 0) continue;
    if (cells[0].classList.contains("diff-hunk-cell")) continue;
    if (cells.length < expectedCells) continue;

    if (isUnifiedLayout) {
      const isContext = cells[0].classList.contains("diff-line-number-neutral");
      const oldEmpty = cells[0].classList.contains("empty-diff-line");
      const newEmpty = cells[1].classList.contains("empty-diff-line");

      if (isContext) {
        result.push({ type: "unchanged", content: cells[2].textContent ?? "" });
      } else if (oldEmpty) {
        result.push({ type: "added", content: stripPrefix(cells[2].textContent ?? "") });
      } else if (newEmpty) {
        result.push({ type: "removed", content: stripPrefix(cells[2].textContent ?? "") });
      }
      continue;
    }

    // Split layout (existing logic, unchanged)
    const leftEmpty = cells[0].classList.contains("empty-diff-line");
    const rightEmpty = cells[2].classList.contains("empty-diff-line");
    const isContext = cells[0].classList.contains("diff-line-number-neutral");

    if (isContext) {
      result.push({ type: "unchanged", content: cells[1].textContent ?? "" });
    } else if (leftEmpty) {
      result.push({ type: "added", content: stripPrefix(cells[3].textContent ?? "") });
    } else if (rightEmpty) {
      result.push({ type: "removed", content: stripPrefix(cells[1].textContent ?? "") });
    } else {
      result.push({ type: "removed", content: stripPrefix(cells[1].textContent ?? "") });
      result.push({ type: "added", content: stripPrefix(cells[3].textContent ?? "") });
    }
  }

  return result;
}
```

## Verification

1. `npm run build` でビルド成功を確認
2. Playwrightで unified diff ページを開き、テーブルが正しくレンダリングされることを確認
3. Split layout で既存の動作に変更がないことを確認
