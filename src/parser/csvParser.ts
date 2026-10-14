/**
 * Parses raw CSV text into a 2D array of strings.
 */

import Papa from "papaparse";

const parseOptions = { header: false, skipEmptyLines: true } as const;

const normalizeLines = (lines: string[]) =>
  lines.map((line) => line.replace(/\r$/, ""));

function parseSegment(
  segmentLines: string[],
  segmentNumbers: Array<number | null>,
  delimiter: string,
): {
  data: string[][];
  lineNumbers: Array<number | null>;
  errors: Papa.ParseError[];
} {
  const raw = segmentLines.join("\n");

  const lineStarts: number[] = [0];
  for (let i = 0; i < segmentLines.length - 1; i++) {
    lineStarts.push(lineStarts[i]! + segmentLines[i]!.length + 1);
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

  const data: string[][] = [];
  const lineNumbers: Array<number | null> = [];
  const errors: Papa.ParseError[] = [];
  let prevCursor = 0;

  Papa.parse<string[]>(raw, {
    ...parseOptions,
    delimiter,
    step: (results) => {
      errors.push(...results.errors);
      let startOffset = prevCursor;
      while (
        startOffset < raw.length &&
        (raw[startOffset] === "\n" || raw[startOffset] === "\r")
      ) {
        startOffset++;
      }
      data.push(results.data);
      lineNumbers.push(segmentNumbers[offsetToLineIndex(startOffset)]!);
      prevCursor = results.meta.cursor;
    },
  });

  return { data, lineNumbers, errors };
}

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

  const normalized = normalizeLines(lines);

  const ranges: Array<[number, number]> = [];
  let expected: number | null = null;
  let segmentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const n = lineNumbers[i];
    if (n != null && expected !== null && n !== expected) {
      ranges.push([segmentStart, i]);
      segmentStart = i;
    }
    // An unreadable line still occupies one physical line.
    if (n != null) expected = n;
    if (expected !== null) expected++;
  }
  ranges.push([segmentStart, lines.length]);

  // An open quote at a segment's end hides every delimiter after it from a
  // joined guess, so guess per segment and share the first detectable one.
  const guesses = ranges.map(([start, end]) =>
    Papa.parse<string[]>(normalized.slice(start, end).join("\n"), {
      ...parseOptions,
      preview: 1,
    }),
  );
  const isDetected = (guess: (typeof guesses)[number]) =>
    !guess.errors.some((error) => error.type === "Delimiter");
  const chosen = guesses.find(isDetected) ?? guesses[0]!;
  const errors = chosen.errors.filter((error) => error.type === "Delimiter");

  const data: string[][] = [];
  const resultLineNumbers: Array<number | null> = [];
  for (const [start, end] of ranges) {
    const segment = parseSegment(
      normalized.slice(start, end),
      lineNumbers.slice(start, end),
      chosen.meta.delimiter,
    );
    data.push(...segment.data);
    resultLineNumbers.push(...segment.lineNumbers);
    errors.push(...segment.errors);
  }

  if (errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", errors);
  }

  if (data.length === 0) {
    const result = Papa.parse<string[]>(normalized.join("\n"), parseOptions);
    return {
      data: result.data,
      lineNumbers: Array(result.data.length).fill(null),
    };
  }

  return { data, lineNumbers: resultLineNumbers };
}
