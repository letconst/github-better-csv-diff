# Inline Diff Highlighting within CSV Cells

## Context

Currently, when a CSV cell is partially modified, the entire cell gets a background highlight (`csv-diff-cell-changed` / `csv-diff-cell-removed`). This makes it hard to spot *what* changed within a cell. The goal is to add character/word-level inline highlighting so users can immediately see which part of a cell value changed, matching GitHub's native inline diff style.

## Approach

Use the `diff` npm package to compute diffs between before/after cell values. Try `diffWordsWithSpace` first for natural word-boundary diffs; fall back to `diffChars` for single-token values (IDs, emails, codes without spaces). Render changed segments as `<span>` elements with GitHub's `--diffBlob-additionWord-bgColor` / `--diffBlob-deletionWord-bgColor` CSS variables. Cell-level background remains as-is; inline spans layer on top.

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Add `diff` (v8+ has built-in types, no `@types/diff` needed) |
| `src/renderer/inlineDiff.ts` | **New** — inline diff computation & DOM fragment building |
| `src/renderer/tableRenderer.ts` | Extend `highlightChangedCells()` to call inline diff |
| `src/styles/diff-table.css` | Add `.csv-diff-inline-added` / `.csv-diff-inline-removed` classes |

## Design

### `src/renderer/inlineDiff.ts`

Two thresholds:
- `inlineDiffThreshold = 0.8` — word-level: require ≥20% unchanged chars relative to max string length
- `charFallbackThreshold = 0.6` — char-level fallback: require ≥60% unchanged chars (stricter, to avoid noisy highlights on short/dissimilar values like `12` → `23`)

Three exported functions:

```typescript
import { diffWordsWithSpace, diffChars, type Change } from "diff";

/** Compute diff with word→char fallback. Returns null if thresholds not met. */
export function computeInlineDiff(before: string, after: string): Change[] | null;

/** Build DocumentFragment for "before" cell from pre-computed changes */
export function renderInlineBefore(changes: Change[]): DocumentFragment;

/** Build DocumentFragment for "after" cell from pre-computed changes */
export function renderInlineAfter(changes: Change[]): DocumentFragment;
```

- `computeInlineDiff`: returns `null` if either value is empty, or if both word-level and char-level diffs exceed their respective thresholds. Diff is computed once and reused by render functions.
- `renderInlineBefore`: iterates `Change[]`, skips `added`, wraps `removed` in `<span class="csv-diff-inline-removed">`, leaves unchanged as text nodes
- `renderInlineAfter`: iterates `Change[]`, skips `removed`, wraps `added` in `<span class="csv-diff-inline-added">`, leaves unchanged as text nodes

### `highlightChangedCells()` in `tableRenderer.ts`

After adding cell-level classes, computes inline diff and renders if non-null:

```typescript
const changes = beforeTd && afterTd ? computeInlineDiff(beforeVal, afterVal) : null;
if (beforeTd && afterTd && changes) {
  beforeTd.textContent = "";
  beforeTd.appendChild(renderInlineBefore(changes));
  afterTd.textContent = "";
  afterTd.appendChild(renderInlineAfter(changes));
}
```

### CSS

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
- **Word-level >80% changed**: falls back to char-level diff
- **Char-level <60% unchanged**: skip inline, cell-level highlight only (avoids noisy highlights on short/dissimilar values)
- **Single-token values** (e.g. `user123` → `user124`): char-level fallback catches these
- **HTML-like content**: safe — using `textContent` + `createTextNode`, never `innerHTML`
- **Whitespace-only diff**: `diffWordsWithSpace` preserves and highlights whitespace changes

## Verification

1. `npm run build` — confirm no type/build errors
2. Load `dist/` in Chrome, open https://github.com/letconst/github-better-csv-diff/pull/2/changes
3. Confirm: modified cells show cell-level background + inline word-level highlighting
4. Confirm: fully changed cells show only cell-level background (no noisy inline spans)
5. Confirm: short dissimilar values (e.g. `12` → `23`) show only cell-level background
6. Confirm: single-token partial changes (e.g. `user123` → `user124`) show inline char-level highlighting
7. Confirm: added/removed rows (no counterpart) are unaffected
8. Test in dark mode — GitHub CSS variables should adapt automatically
