# Plan: Newline Indicator in Inline Diffs

## Context

When a newline character is added or removed at the beginning or end of a CSV cell value, the cell is highlighted as changed but the user cannot visually tell what changed — a leading/trailing `<br>` is invisible or ambiguous. This change adds a `↵` symbol at newline positions within changed diff chunks to make the change explicit.

## Files to Modify

1. **`src/renderer/inlineDiff.ts`** — Add newline indicator logic to `appendTextWithBreaks()`, export it
2. **`src/renderer/tableRenderer.ts`** — Use exported `appendTextWithBreaks()` for fallback when `computeInlineDiff()` returns `null`
3. **`src/styles/diff-table.css`** — Add `.csv-diff-newline-indicator` style

## Implementation

### 1. `src/renderer/inlineDiff.ts`

Add a `showIndicator` parameter to `appendTextWithBreaks()` and **export** it:

```typescript
export function appendTextWithBreaks(
  parent: DocumentFragment | HTMLElement,
  text: string,
  showIndicator = false,
): void {
  if (!text.includes("\n") && !text.includes("\r")) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      if (showIndicator) {
        const indicator = document.createElement("span");
        indicator.className = "csv-diff-newline-indicator";
        indicator.setAttribute("aria-hidden", "true");
        // Rendered via CSS ::before pseudo-element for clipboard safety
        parent.appendChild(indicator);
      }
      parent.appendChild(document.createElement("br"));
    }
    parent.appendChild(document.createTextNode(parts[i]));
  }
}
```

Call-site changes within `inlineDiff.ts`:
- `renderInlineBefore` — removed chunks: `appendTextWithBreaks(span, change.value, true)`
- `renderInlineAfter` — added chunks: `appendTextWithBreaks(span, change.value, true)`
- Unchanged text: keep as `appendTextWithBreaks(fragment, change.value)` (no indicator)

### 2. `src/renderer/tableRenderer.ts`

Import `appendTextWithBreaks` from `./inlineDiff`.

In `highlightChangedCells()` (~line 315), add an `else` branch for when `computeInlineDiff()` returns `null` but values contain newlines:

```typescript
if (beforeTd && afterTd && changes) {
  beforeTd.textContent = "";
  beforeTd.appendChild(renderInlineBefore(changes));
  afterTd.textContent = "";
  afterTd.appendChild(renderInlineAfter(changes));
} else {
  // Fallback: re-render cells with newline indicators when inline diff is unavailable
  const beforeHasBreak = beforeVal.includes("\n") || beforeVal.includes("\r");
  const afterHasBreak = afterVal.includes("\n") || afterVal.includes("\r");
  if (beforeHasBreak || afterHasBreak) {
    if (beforeTd) {
      beforeTd.textContent = "";
      appendTextWithBreaks(beforeTd, beforeVal, true);
    }
    if (afterTd) {
      afterTd.textContent = "";
      appendTextWithBreaks(afterTd, afterVal, true);
    }
  }
}
```

This covers cases where `computeInlineDiff()` returns `null` (empty string on one side, or changes exceeding thresholds) but the cell values still contain newlines that need to be visible.

### 3. `src/styles/diff-table.css`

Add after `.csv-diff-inline-removed`:

```css
.csv-diff-newline-indicator {
  display: inline-block;
  opacity: 0.6;
  font-size: 0.85em;
  user-select: none;
  pointer-events: none;
}

.csv-diff-newline-indicator::before {
  content: "↵";
}
```

The `↵` is rendered via CSS `::before` pseudo-element instead of `textContent` — this should exclude the symbol from clipboard copy in most browsers (verified in Chromium; Firefox to be tested manually). The indicator `<span>` inherits the parent's diff highlight background color (green/red) when nested inside `.csv-diff-inline-added` / `.csv-diff-inline-removed`.

## Scope

- Show `↵` for newlines inside inline diff added/removed chunks (only changed newlines get indicators)
- Show `↵` for **all** newlines in changed cells when inline diff is unavailable (fallback path) — this is acceptable because the fallback fires only when one side is empty or changes exceed the threshold, meaning the entire cell content is effectively changed
- All line ending types (`\n`, `\r\n`, `\r`) are normalized to `\n` before indicator insertion (existing behavior)
- Unchanged newlines in unchanged rows/cells remain as plain `<br>` (no indicator)
- `setTextWithBreaks()` in `tableRenderer.ts` is not modified (normal/unchanged cell rendering unaffected)

## Verification

1. `npm run build` — no build errors
2. Browser testing:
   - Newline appended: `"hello"` → `"hello\n"` — After side shows `↵` with diff highlight
   - Newline prepended: `"hello"` → `"\nhello"` — After side shows `↵` with diff highlight
   - Mid-text newline change: only changed newlines show `↵`; unchanged newlines render as `<br>` only
   - Single-line change (no newlines): no `↵` symbol appears
   - Empty to newline: `""` → `"\n"` — After side shows `↵` (fallback path)
   - Newline to empty: `"\n"` → `""` — Before side shows `↵` (fallback path)
   - Threshold exceeded: both sides are non-empty multiline values with large diff (e.g. `"aaa\nbbb"` → `"xxx\nyyy"`) causing `computeInlineDiff()` to return `null` — fallback renders `↵` on all breaks
   - `\r\n` diffs: indicator displays correctly after normalization
   - `↵` is excluded from text selection/copy (CSS pseudo-element) — verify in both Chrome and Firefox
   - Both light and dark GitHub themes: indicator contrast is acceptable
