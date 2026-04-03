# Line Number Styling Improvements

## Context
Line numbers were recently added to the CSV diff table view. Currently they are right-aligned with muted gray text, and don't visually reflect the diff state of their row. The user wants them to match GitHub's raw diff view styling more closely.

## Changes

### 1. Center-align line numbers (`src/styles/diff-table.css`)
- Change `text-align: right` → `text-align: center` in `.csv-diff-line-num`

### 2. Add background/foreground colors for added/removed rows (`src/styles/diff-table.css`)
Add CSS rules:
```css
.csv-diff-row-added .csv-diff-line-num {
  background: var(--diffBlob-additionNum-bgColor, #ccffd8);
  color: var(--diffBlob-additionNum-fgColor, #116329);
}

.csv-diff-row-removed .csv-diff-line-num {
  background: var(--diffBlob-deletionNum-bgColor, #ffd7d5);
  color: var(--diffBlob-deletionNum-fgColor, #82071e);
}
```

### 3. Style line number cells for modified rows (`src/styles/diff-table.css` + `src/renderer/tableRenderer.ts`)

Modified rows don't have a row-level class — cell highlighting is done in `highlightChangedCells()`. Need to also style the line number cell there.

**CSS:** Add two new classes:
```css
.csv-diff-line-num-added {
  background: var(--diffBlob-additionNum-bgColor, #ccffd8);
  color: var(--diffBlob-additionNum-fgColor, #116329);
}

.csv-diff-line-num-removed {
  background: var(--diffBlob-deletionNum-bgColor, #ffd7d5);
  color: var(--diffBlob-deletionNum-fgColor, #82071e);
}
```

**TypeScript:** In `highlightChangedCells()` (tableRenderer.ts), after confirming `match.type === "modified"`, add classes to the line number cells (`children[0]`):
- `beforeTr.children[0]` → add `csv-diff-line-num-removed`
- `afterTr.children[0]` → add `csv-diff-line-num-added`

## Files to Modify
- `src/styles/diff-table.css` (lines 116-133)
- `src/renderer/tableRenderer.ts` (lines 157-186, `highlightChangedCells`)

## Verification
- `npm run build` to confirm no errors ✅
- Load extension in browser and check a CSV diff with added, removed, and modified rows
- Verify line numbers are centered
- Verify added/removed/modified rows have correct background and text colors on line number cells

### 4. Sticky line number column on horizontal scroll (`src/styles/diff-table.css`)

Keep the line number column pinned at the left edge while scrolling horizontally.

**Prerequisite:** `position: sticky` on table cells does not work with `border-collapse: collapse`. Must switch to `border-collapse: separate; border-spacing: 0;`.

**CSS changes:**

1. `.csv-diff-side table` → `border-collapse: separate; border-spacing: 0;`
2. `.csv-diff-line-num` → add `position: sticky; left: 0; z-index: 1;`
3. Every line-num cell state needs an explicit `background` so data cells don't bleed through on scroll:
   - Default (unchanged rows): `background: var(--bgColor-default, #ffffff);`
   - `th.csv-diff-line-num`: `background: var(--bgColor-muted, #f6f8fa);` (header row)
   - added/removed/modified: already covered by steps 2-3
   - empty rows: `background: var(--diffBlob-emptyLine-bgColor, var(--bgColor-muted, #f6f8fa));`
4. `th.csv-diff-line-num` → add `z-index: 2;` (topmost at top+left intersection)
