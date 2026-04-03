# Multiline Cell Rendering

## Context

PR #27 fixed line number mapping for multiline quoted CSV fields. Cells now correctly contain `\n` characters — but they render as invisible whitespace because content is set via `textContent` and CSS uses `white-space: nowrap`. Users expect visible line breaks.

Follow-up to PR #27. Branch: `feature/multiline-cell-rendering`.

## Changes

### 1. Shared helper: `setTextWithBreaks()` — `src/renderer/tableRenderer.ts`

Single helper used for both body cells and header cells. Normalizes `\r\n`/`\r` to `\n` before splitting (defensive, even though PapaParse normalizes):

```ts
function setTextWithBreaks(parent: HTMLElement, text: string): void {
  if (!text.includes("\n") && !text.includes("\r")) {
    parent.textContent = text;
    return;
  }
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) parent.appendChild(document.createElement("br"));
    parent.appendChild(document.createTextNode(parts[i]));
  }
}
```

Apply to:
- **Body cells** `buildSide()` line 217: `td.textContent = row[i]` → `setTextWithBreaks(td, row[i])`
- **Header cells** `buildSide()` line 181: `th.textContent = headers[i]` → `setTextWithBreaks(th, headers[i])`

### 2. Inline diff helper: `appendTextWithBreaks()` — `src/renderer/inlineDiff.ts`

Same logic but accepts `DocumentFragment | HTMLElement`:

```ts
function appendTextWithBreaks(parent: DocumentFragment | HTMLElement, text: string): void {
  if (!text.includes("\n") && !text.includes("\r")) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) parent.appendChild(document.createElement("br"));
    parent.appendChild(document.createTextNode(parts[i]));
  }
}
```

Update `renderInlineBefore()` (lines 49-64):
- `span.textContent = change.value` → `appendTextWithBreaks(span, change.value)`
- `document.createTextNode(change.value)` → `appendTextWithBreaks(fragment, change.value)`

Update `renderInlineAfter()` (lines 71-87): same pattern.

### 3. Row height sync — `src/renderer/tableRenderer.ts`

Export `syncRowHeights()`. Syncs **all** `<tr>` (thead + tbody), not just tbody. Clears prior heights before measuring:

```ts
export function syncRowHeights(container: HTMLElement): void {
  const tables = container.querySelectorAll<HTMLTableElement>(".csv-diff-side table");
  if (tables.length !== 2) return;

  const beforeRows = tables[0].querySelectorAll<HTMLTableRowElement>("tr");
  const afterRows = tables[1].querySelectorAll<HTMLTableRowElement>("tr");
  const len = Math.min(beforeRows.length, afterRows.length);

  // Clear prior heights so natural height is measured
  for (let i = 0; i < len; i++) {
    beforeRows[i].style.height = "";
    afterRows[i].style.height = "";
  }

  for (let i = 0; i < len; i++) {
    const px = `${Math.max(beforeRows[i].offsetHeight, afterRows[i].offsetHeight)}px`;
    beforeRows[i].style.height = px;
    afterRows[i].style.height = px;
  }
}
```

**Call sites** in `src/content/observer.ts` — placed directly next to DOM mutations:
1. **Line 508** — after `diffBody.prepend(wrapper)`: call `syncRowHeights(tableElement)` (variable already in scope)
2. **Line 333** — after `oldContainer.replaceWith(newTable)`: call `syncRowHeights(newTable)`

### 4. CSS — `src/styles/diff-table.css`

No change to `white-space: nowrap` — `<br>` forces breaks even under `nowrap`.

Add `vertical-align: top` to both `td` and `th`:

```css
.csv-diff-side td {
  vertical-align: top;
}

.csv-diff-side th {
  vertical-align: top;
}
```

## Files to modify

| File | Change |
|------|--------|
| `src/renderer/tableRenderer.ts` | Add `setTextWithBreaks()`, use for body+header cells; export `syncRowHeights()` |
| `src/renderer/inlineDiff.ts` | Add `appendTextWithBreaks()`, use in both render functions |
| `src/styles/diff-table.css` | Add `vertical-align: top` to `td` and `th` |
| `src/content/observer.ts` | Import+call `syncRowHeights()` at 2 DOM mutation points |

## Verification

1. `npm run build` — compiles without errors
2. Load extension, navigate to a CSV diff with multiline quoted fields (e.g. `"Line 1\nLine 2"`)
3. Verify: cell shows two lines with a visible break
4. Verify: Before/After rows have matching heights
5. Verify: inline diff highlighting works on multiline cells
6. Verify: **header cells** with multiline values render correctly
7. Verify: cells with consecutive blank lines (`"a\n\nb"`) and trailing newlines (`"a\n"`) render correctly
8. Verify: single-line CSVs render identically to before (no regression)
9. Verify: after async header fetch re-render, row heights are still synced
10. Verify: `\r\n` and lone `\r` in multiline cell values render as line breaks (not visible characters)
