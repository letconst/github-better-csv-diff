/**
 * Parses raw CSV text into a 2D array of strings.
 */

import Papa from "papaparse";

const parseOptions = { header: false, skipEmptyLines: true } as const;

const normalizeLines = (lines: string[]) =>
  lines.map((line) => line.replace(/\r$/, ""));

/**
 * Parses CSV while tracking which physical input line each CSV row starts on.
 * Uses Papa's `step` callback with `meta.cursor` to map character offsets
 * back to physical line indices, correctly handling multiline quoted fields
 * and skipped empty lines.
 *
 * Lines are split into segments wherever the physical line numbers are not
 * consecutive (i.e. between diff hunks), and each segment is parsed on its own
 * so an open quote at the end of one hunk cannot swallow the next.
 */
export function parseCsvWithLineMap(
  lines: string[],
  lineNumbers: Array<number | null>,
): { data: string[][]; lineNumbers: Array<number | null> } {
  if (lines.length === 0) {
    return { data: [], lineNumbers: [] };
  }

  const data: string[][] = [];
  const resultLineNumbers: Array<number | null> = [];
  const errors: Papa.ParseError[] = [];

  function parseSegment(start: number, end: number): void {
    const normalizedLines = normalizeLines(lines.slice(start, end));
    const raw = normalizedLines.join("\n");

    const lineStarts: number[] = [0];
    for (let i = 0; i < normalizedLines.length - 1; i++) {
      lineStarts.push(lineStarts[i]! + normalizedLines[i]!.length + 1);
    }

    function offsetToLineIndex(offset: number): number {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }

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
        resultLineNumbers.push(lineNumbers[start + lineIdx]!);
        prevCursor = results.meta.cursor;
      },
    });
  }

  let expected: number | null = null;
  let segmentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const n = lineNumbers[i] ?? null;
    if (n !== null && expected !== null && n !== expected) {
      parseSegment(segmentStart, i);
      segmentStart = i;
    }
    // An unreadable line still occupies one physical line.
    const current: number | null = n ?? expected;
    expected = current === null ? null : current + 1;
  }
  parseSegment(segmentStart, lines.length);

  if (errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", errors);
  }

  if (data.length === 0) {
    const result = Papa.parse<string[]>(
      normalizeLines(lines).join("\n"),
      parseOptions,
    );
    return {
      data: result.data,
      lineNumbers: Array(result.data.length).fill(null),
    };
  }

  return { data, lineNumbers: resultLineNumbers };
}
