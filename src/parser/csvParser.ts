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
