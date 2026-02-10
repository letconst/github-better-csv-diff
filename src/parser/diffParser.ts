/**
 * Parses unified diff text extracted from GitHub DOM into structured diff data.
 */

import { parseCsv } from "./csvParser";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

export interface CsvDiff {
  before: string[][];
  after: string[][];
}

export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines = diffText.split("\n");
  const result: DiffLine[] = [];

  for (const line of lines) {
    if (
      line.startsWith("@@") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      result.push({ type: "added", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      result.push({ type: "unchanged", content: line.slice(1) });
    }
  }

  return result;
}

export function diffToCsv(lines: DiffLine[]): CsvDiff {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];

  for (const line of lines) {
    if (line.type === "removed" || line.type === "unchanged") {
      beforeLines.push(line.content);
    }
    if (line.type === "added" || line.type === "unchanged") {
      afterLines.push(line.content);
    }
  }

  return {
    before: parseCsv(beforeLines.join("\n")),
    after: parseCsv(afterLines.join("\n")),
  };
}

/**
 * Extracts DiffLine[] directly from a GitHub diff container's DOM (Split Layout).
 * This avoids reconstructing unified diff text by reading line types from CSS classes.
 */
export function extractDiffLinesFromDom(container: HTMLElement): DiffLine[] {
  const table = container.querySelector<HTMLTableElement>(
    'table[role="grid"]'
  );
  if (!table) {
    console.warn("[GitHub Better CSV Diff] No diff table found in container");
    return [];
  }

  const rows = table.querySelectorAll<HTMLTableRowElement>("tr.diff-line-row");
  const result: DiffLine[] = [];

  // Detect layout: find first non-hunk row with a recognized cell count (3 or 4)
  let isUnifiedLayout = false;
  for (const row of rows) {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    if (cells.length === 0) continue;
    if (cells[0].classList.contains("diff-hunk-cell")) continue;
    if (cells.length === 3) { isUnifiedLayout = true; break; }
    if (cells.length === 4) { isUnifiedLayout = false; break; }
    // Unexpected cell count — keep scanning
  }

  const expectedCells = isUnifiedLayout ? 3 : 4;

  for (const row of rows) {
    const cells = row.querySelectorAll<HTMLTableCellElement>("td");
    if (cells.length === 0) continue;

    // Hunk header (single cell spanning all columns)
    if (cells[0].classList.contains("diff-hunk-cell")) {
      continue;
    }

    if (cells.length < expectedCells) continue;

    if (isUnifiedLayout) {
      // Unified layout: cells[0]=old line num, cells[1]=new line num, cells[2]=content
      const isContext = cells[0].classList.contains("diff-line-number-neutral");
      const oldEmpty = cells[0].classList.contains("empty-diff-line");
      const newEmpty = cells[1].classList.contains("empty-diff-line");

      if (isContext) {
        result.push({
          type: "unchanged",
          content: cells[2].textContent ?? "",
        });
      } else if (oldEmpty) {
        result.push({
          type: "added",
          content: stripPrefix(cells[2].textContent ?? ""),
        });
      } else if (newEmpty) {
        result.push({
          type: "removed",
          content: stripPrefix(cells[2].textContent ?? ""),
        });
      } else {
        console.warn(
          "[GitHub Better CSV Diff] Unhandled unified layout row",
          cells[2].textContent
        );
      }
      continue;
    }

    // Split layout: cells[0]=left num, cells[1]=left content,
    //               cells[2]=right num, cells[3]=right content
    const leftEmpty = cells[0].classList.contains("empty-diff-line");
    const rightEmpty = cells[2].classList.contains("empty-diff-line");
    const isContext = cells[0].classList.contains("diff-line-number-neutral");

    if (isContext) {
      result.push({
        type: "unchanged",
        content: cells[1].textContent ?? "",
      });
    } else if (leftEmpty) {
      result.push({
        type: "added",
        content: stripPrefix(cells[3].textContent ?? ""),
      });
    } else if (rightEmpty) {
      result.push({
        type: "removed",
        content: stripPrefix(cells[1].textContent ?? ""),
      });
    } else {
      // Modified line -- both sides present
      result.push({
        type: "removed",
        content: stripPrefix(cells[1].textContent ?? ""),
      });
      result.push({
        type: "added",
        content: stripPrefix(cells[3].textContent ?? ""),
      });
    }
  }

  return result;
}

function stripPrefix(text: string): string {
  if (text.startsWith("+") || text.startsWith("-")) {
    return text.slice(1);
  }
  return text;
}
