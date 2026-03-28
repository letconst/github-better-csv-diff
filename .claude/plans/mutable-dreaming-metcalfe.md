# Fix: CSV diff table missing line numbers for files with multiline fields

## Context

On GitHub diff pages, some CSV files show empty line numbers (`#` column) in the extension's CSV diff table.

**Root cause:** When CSV fields contain embedded quote characters (e.g., text like `"Telescope"` or embedded JSON), `parseCsv()` correctly merges multiple physical lines into fewer CSV rows (multiline quoted fields). This causes a length mismatch between the parsed CSV rows and the line number array in `diffToCsv()`, triggering a fallback that nullifies ALL line numbers.

For example, 16 physical lines may parse into 7 CSV rows. The length-check `before.length === beforeLineNumbers.length` fails, and all line numbers become `null`.

## Approach

**Use Papa's `step` callback with `meta.cursor`** to track which physical line each parsed CSV row starts on. Map the first physical line's number to each CSV row, eliminating the need for length-matching entirely.

This solves both:
- Multiline CSV fields (primary cause, confirmed)
- Empty lines skipped by `skipEmptyLines` (secondary cause, theoretical)

## Changes

### `src/parser/csvParser.ts`

Add `parseCsvWithLineMap(lines, lineNumbers)` — a new export that parses CSV while tracking physical line → CSV row mapping via `meta.cursor`.

```typescript
export function parseCsvWithLineMap(
  lines: string[],
  lineNumbers: Array<number | null>,
): { data: string[][]; lineNumbers: Array<number | null> } {
  if (lines.length === 0) {
    return { data: [], lineNumbers: [] };
  }

  // Normalize CRLF to LF before joining
  const normalizedLines = lines.map((line) => line.replace(/\r$/, ""));
  const raw = normalizedLines.join("\n");

  // Build character offset → physical line index mapping
  const lineStarts: number[] = [0];
  for (let i = 0; i < normalizedLines.length - 1; i++) {
    lineStarts.push(lineStarts[i] + normalizedLines[i].length + 1);
  }

  function offsetToLineIndex(offset: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const data: string[][] = [];
  const mapped: Array<number | null> = [];
  const errors: Papa.ParseError[] = [];
  let prevCursor = 0;

  Papa.parse<string[]>(raw, {
    header: false,
    skipEmptyLines: true,
    step: (results) => {
      if (results.errors.length > 0) {
        errors.push(...results.errors);
      }
      // Skip past any newlines between previous row end and current row start
      let startOffset = prevCursor;
      while (
        startOffset < raw.length &&
        (raw[startOffset] === "\n" || raw[startOffset] === "\r")
      ) {
        startOffset++;
      }
      const lineIdx = offsetToLineIndex(startOffset);
      data.push(results.data);
      mapped.push(lineNumbers[lineIdx]);
      prevCursor = results.meta.cursor;
    },
  });

  if (errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", errors);
  }

  if (data.length === 0) {
    // Fallback: if step callback produced nothing, use regular parse
    const result = Papa.parse<string[]>(raw, {
      header: false,
      skipEmptyLines: true,
    });
    return {
      data: result.data,
      lineNumbers: Array(result.data.length).fill(null),
    };
  }

  return { data, lineNumbers: mapped };
}
```

### `src/parser/diffParser.ts`

1. Replace `import { parseCsv }` with `import { parseCsvWithLineMap }` from `csvParser`.
2. Remove the previously added `filterUnquotedEmptyLines`, `advanceQuotedFieldState`, `isBlankLine` functions (from the incorrect fix).
3. Simplify `diffToCsv()`:

```typescript
export function diffToCsv(lines: DiffLine[]): CsvDiff {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  const beforeLineNumbers: Array<number | null> = [];
  const afterLineNumbers: Array<number | null> = [];

  for (const line of lines) {
    if (line.type === "removed" || line.type === "unchanged") {
      beforeLines.push(line.content);
      beforeLineNumbers.push(line.oldLineNumber);
    }
    if (line.type === "added" || line.type === "unchanged") {
      afterLines.push(line.content);
      afterLineNumbers.push(line.newLineNumber);
    }
  }

  const before = parseCsvWithLineMap(beforeLines, beforeLineNumbers);
  const after = parseCsvWithLineMap(afterLines, afterLineNumbers);

  return {
    before: before.data,
    after: after.data,
    beforeLineNumbers: before.lineNumbers,
    afterLineNumbers: after.lineNumbers,
  };
}
```

No length-check fallback needed — the mapping is inherently correct.

### No other files need changes

- `tableRenderer.ts`: Already handles `null` line numbers correctly
- `uiConfig.ts`: Unrelated
- Keep `parseCsv()` in `csvParser.ts` (not removed, may be useful for other callers)

## Files to modify

- `src/parser/csvParser.ts` — add `parseCsvWithLineMap`
- `src/parser/diffParser.ts` — use new function, remove incorrect fix

## Verification

1. `npm run build` — no type/build errors
2. Load extension, navigate to a GitHub diff page with a CSV file containing multiline fields
3. Verify line numbers appear in `#` column on both Before and After sides
4. Other CSV files on the same page still show correct line numbers
5. Check a simple CSV (no multiline fields) is unaffected
6. Edge cases:
   - Multiline CSV field → first physical line's number used for that CSV row
   - Empty line in CSV → correctly skipped, subsequent rows keep correct line numbers
   - Single-line CSV rows → straightforward 1:1 mapping preserved
