/**
 * Parses raw CSV text into a 2D array of strings.
 */

import Papa from "papaparse";

const parseOptions = { header: false, skipEmptyLines: true } as const;

const normalizeLines = (lines: string[]) =>
  lines.map((line) => line.replace(/\r$/, ""));

interface CsvRecord {
  row: string[];
  start: number;
  /** Offset of the record's last character, excluding its terminator. */
  end: number;
}

function parseRecords(
  raw: string,
  delimiter: string,
): { records: CsvRecord[]; errors: Papa.ParseError[] } {
  const records: CsvRecord[] = [];
  const errors: Papa.ParseError[] = [];
  let prevCursor = 0;

  Papa.parse<string[]>(raw, {
    ...parseOptions,
    delimiter,
    step: (results) => {
      errors.push(...results.errors);
      let start = prevCursor;
      while (
        start < raw.length &&
        (raw[start] === "\n" || raw[start] === "\r")
      ) {
        start++;
      }
      const cursor = results.meta.cursor;
      records.push({
        row: results.data,
        start,
        end: raw[cursor - 1] === "\n" ? cursor - 2 : cursor - 1,
      });
      prevCursor = cursor;
    },
  });

  return { records, errors };
}

function lineIndexLookup(lines: string[]): (offset: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStarts.push(lineStarts[i]! + lines[i]!.length + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

function parseSegment(
  segmentLines: string[],
  segmentNumbers: Array<number | null>,
  delimiter: string,
): {
  data: string[][];
  lineNumbers: Array<number | null>;
  errors: Papa.ParseError[];
} {
  const lineIndexAt = lineIndexLookup(segmentLines);
  const { records, errors } = parseRecords(segmentLines.join("\n"), delimiter);
  return {
    data: records.map((record) => record.row),
    lineNumbers: records.map(
      (record) => segmentNumbers[lineIndexAt(record.start)]!,
    ),
    errors,
  };
}

interface FileRecord {
  row: string[];
  startLine: number;
  endLine: number;
}

function parseFileRecords(
  fileLines: string[],
  delimiter: string,
): { records: FileRecord[]; errors: Papa.ParseError[] } {
  const lineIndexAt = lineIndexLookup(fileLines);
  const parsed = parseRecords(fileLines.join("\n"), delimiter);
  return {
    records: parsed.records.map((record) => ({
      row: record.row,
      startLine: lineIndexAt(record.start) + 1,
      endLine: lineIndexAt(Math.max(record.start, record.end)) + 1,
    })),
    errors: parsed.errors,
  };
}

const hasOddQuoteCount = (lines: string[]) =>
  (lines.join("\n").match(/"/g)?.length ?? 0) % 2 === 1;

/**
 * Parses CSV while tracking which physical input line each CSV row starts on.
 * Uses Papa's `step` callback with `meta.cursor` to map character offsets
 * back to physical line indices, correctly handling multiline quoted fields
 * and skipped empty lines.
 *
 * Lines are split into segments wherever the physical line numbers are not
 * consecutive (i.e. between diff hunks), and each segment is parsed on its own
 * so an open quote at the end of one hunk cannot swallow the next.
 *
 * A segment with an odd number of quotes is cut (a quoted record continues in
 * a collapsed region). With `fileText` (the whole file at this side's
 * revision) such a segment is replaced by the complete records it touches.
 * `cut[i]` flags rows of a cut segment that stayed a fragment.
 */
export function parseCsvWithLineMap(
  lines: string[],
  lineNumbers: Array<number | null>,
  fileText?: string | null,
): { data: string[][]; lineNumbers: Array<number | null>; cut: boolean[] } {
  if (lines.length === 0) {
    return { data: [], lineNumbers: [], cut: [] };
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
  const delimiter = chosen.meta.delimiter;
  const errors = chosen.errors.filter((error) => error.type === "Delimiter");

  let fileRecords: FileRecord[] = [];
  let fileLines: string[] = [];
  if (fileText != null) {
    fileLines = normalizeLines(fileText.split("\n"));
    const parsed = parseFileRecords(fileLines, delimiter);
    fileRecords = parsed.records;
    errors.push(...parsed.errors);
  }

  let mismatched = false;
  const reconstruct = (
    segmentLines: string[],
    segmentNumbers: Array<number | null>,
  ): ReturnType<typeof parseSegment> | null => {
    const numbered = segmentNumbers.filter((n): n is number => n != null);
    if (fileText == null || numbered.length === 0) return null;
    const matches = segmentNumbers.every(
      (n, i) => n == null || fileLines[n - 1] === segmentLines[i],
    );
    if (!matches) {
      mismatched = true;
      return null;
    }
    const first = numbered[0]!;
    const last = numbered[numbered.length - 1]!;
    const hits = fileRecords.filter(
      (record) => record.endLine >= first && record.startLine <= last,
    );
    if (hits.length === 0) return null;
    return {
      data: hits.map((record) => record.row),
      lineNumbers: hits.map((record) => Math.max(record.startLine, first)),
      errors: [],
    };
  };

  const data: string[][] = [];
  const resultLineNumbers: Array<number | null> = [];
  const cut: boolean[] = [];
  for (const [start, end] of ranges) {
    const segmentLines = normalized.slice(start, end);
    const segmentNumbers = lineNumbers.slice(start, end);
    const isCut = hasOddQuoteCount(segmentLines);
    const rebuilt = isCut ? reconstruct(segmentLines, segmentNumbers) : null;
    const segment =
      rebuilt ?? parseSegment(segmentLines, segmentNumbers, delimiter);
    data.push(...segment.data);
    resultLineNumbers.push(...segment.lineNumbers);
    cut.push(...segment.data.map(() => isCut && rebuilt === null));
    errors.push(...segment.errors);
  }

  if (mismatched) {
    console.warn(
      "[GitHub Better CSV Diff] Fetched file does not match the diff; keeping the cut record fragment",
    );
  }

  if (errors.length > 0) {
    console.warn("[GitHub Better CSV Diff] CSV parse errors:", errors);
  }

  if (data.length === 0) {
    const result = Papa.parse<string[]>(normalized.join("\n"), parseOptions);
    return {
      data: result.data,
      lineNumbers: Array(result.data.length).fill(null),
      cut: Array(result.data.length).fill(false),
    };
  }

  return { data, lineNumbers: resultLineNumbers, cut };
}
