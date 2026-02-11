# Inline Diff Highlighting within CSV Cells

## Context

Currently, when a CSV cell is partially modified, the entire cell gets a background highlight (`csv-diff-cell-changed` / `csv-diff-cell-removed`). This makes it hard to spot *what* changed within a cell. The goal is to add character/word-level inline highlighting so users can immediately see which part of a cell value changed, matching GitHub's native inline diff style.

## Approach

Use the `diff` npm package (`diffWordsWithSpace`) to compute word-level diffs between before/after cell values. Render changed segments as `<span>` elements with GitHub's `--diffBlob-additionWord-bgColor` / `--diffBlob-deletionWord-bgColor` CSS variables. Cell-level background remains as-is; inline spans layer on top.

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `diff` + `@types/diff` |
| `src/renderer/inlineDiff.ts` | **New** — inline diff computation & DOM fragment building |
| `src/renderer/tableRenderer.ts` | Extend `highlightChangedCells()` (line 141) to call inline diff |
| `src/styles/diff-table.css` | Add `.csv-diff-inline-added` / `.csv-diff-inline-removed` classes |

## Step-by-step

### 1. Install `diff` package

```bash
npm install diff
npm install --save-dev @types/diff
```

### 2. Create `src/renderer/inlineDiff.ts`

Three exported functions:

```typescript
import { diffWordsWithSpace } from "diff";

const INLINE_DIFF_THRESHOLD = 0.8;

/** Skip inline highlighting when >80% changed or either side is empty */
export function shouldInlineHighlight(before: string, after: string): boolean;

/** Build DocumentFragment for "before" cell: removed segments wrapped in <span class="csv-diff-inline-removed"> */
export function renderInlineBefore(before: string, after: string): DocumentFragment;

/** Build DocumentFragment for "after" cell: added segments wrapped in <span class="csv-diff-inline-added"> */
export function renderInlineAfter(before: string, after: string): DocumentFragment;
```

- `shouldInlineHighlight`: returns `false` if either value is empty, or if changed chars / total chars > 0.8
- `renderInlineBefore`: iterates `Change[]`, skips `added`, wraps `removed` in `<span>`, leaves unchanged as text nodes
- `renderInlineAfter`: iterates `Change[]`, skips `removed`, wraps `added` in `<span>`, leaves unchanged as text nodes

### 3. Modify `highlightChangedCells()` in `tableRenderer.ts`

At line 141 (`if (bVal !== aVal)` block), after adding cell-level classes, add:

```typescript
if (bTd && aTd && shouldInlineHighlight(bVal, aVal)) {
  bTd.textContent = "";
  bTd.appendChild(renderInlineBefore(bVal, aVal));
  aTd.textContent = "";
  aTd.appendChild(renderInlineAfter(bVal, aVal));
}
```

### 4. Add CSS (after `.csv-diff-cell-removed` block, ~line 68)

```css
.csv-diff-inline-added {
  background: var(--diffBlob-additionWord-bgColor, #abf2bc);
  border-radius: 2px;
  padding: 1px 0;
}

.csv-diff-inline-removed {
  background: var(--diffBlob-deletionWord-bgColor, #ffcecb);
  border-radius: 2px;
  padding: 1px 0;
}
```

## Edge Cases

- **Empty before/after**: skip inline, cell-level highlight only
- **>80% changed**: skip inline, cell-level highlight only (too noisy)
- **HTML-like content**: safe — using `textContent` + `createTextNode`, never `innerHTML`
- **Whitespace-only diff**: `diffWordsWithSpace` preserves and highlights whitespace changes

## Verification

1. `npm run build` — confirm no type/build errors
2. Load `dist/` in Chrome, open https://github.com/letconst/github-better-csv-diff/pull/2/changes
3. Confirm: modified cells show cell-level background + inline word-level highlighting
4. Confirm: fully changed cells (>80%) show only cell-level background
5. Confirm: added/removed rows (no counterpart) are unaffected
6. Test in dark mode — GitHub CSS variables should adapt automatically
