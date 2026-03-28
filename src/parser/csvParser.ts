/**
 * Parses raw CSV text into a 2D array of strings.
 */

import Papa from "papaparse";

export function parseCsv(raw: string): string[][] {
  const result = Papa.parse<string[]>(raw, {
    header: false,
    skipEmptyLines: true,
  });
  if (result.errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", result.errors);
  }
  return result.data;
}

/**
 * Parses CSV while tracking which physical input line each CSV row starts on.
 * Uses Papa's `step` callback with `meta.cursor` to map character offsets
 * back to physical line indices, correctly handling multiline quoted fields
 * and skipped empty lines.
 */
export function parseCsvWithLineMap(
  lines: string[],
  lineNumbers: Array<number | null>,
): { data: string[][]; lineNumbers: Array<number | null> } {
  if (lines.length === 0) {
    return { data: [], lineNumbers: [] };
  }

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

  const parseOptions = { header: false, skipEmptyLines: true } as const;

  const data: string[][] = [];
  const resultLineNumbers: Array<number | null> = [];
  const errors: Papa.ParseError[] = [];
  let prevCursor = 0;

  Papa.parse<string[]>(raw, {
    ...parseOptions,
    step: (results) => {
      if (results.errors.length > 0) {
        errors.push(...results.errors);
      }
      let startOffset = prevCursor;
      while (
        startOffset < raw.length &&
        (raw[startOffset] === "\n" || raw[startOffset] === "\r")
      ) {
        startOffset++;
      }
      const lineIdx = offsetToLineIndex(startOffset);
      data.push(results.data);
      resultLineNumbers.push(lineNumbers[lineIdx]);
      prevCursor = results.meta.cursor;
    },
  });

  if (errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", errors);
  }

  if (data.length === 0) {
    const result = Papa.parse<string[]>(raw, parseOptions);
    return {
      data: result.data,
      lineNumbers: Array(result.data.length).fill(null),
    };
  }

  return { data, lineNumbers: resultLineNumbers };
}
