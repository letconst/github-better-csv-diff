/**
 * Renders side-by-side (Before / After) diff tables from parsed CSV data.
 */

import type { CsvDiff } from "../parser/diffParser";
import {
  appendTextWithBreaks,
  computeInlineDiff,
  renderInlineAfter,
  renderInlineBefore,
} from "./inlineDiff";

export interface MatchedRow {
  before: string[] | null;
  after: string[] | null;
  type: "added" | "removed" | "modified" | "unchanged";
  beforeLineNumber: number | null;
  afterLineNumber: number | null;
}

export interface SideHeaderMode {
  mode: "default" | "external" | "loading";
  /** Header row to display. Required when mode is "external". */
  headers?: string[];
}

export interface RenderOptions {
  before?: SideHeaderMode;
  after?: SideHeaderMode;
}

/**
 * Resolve header and data arrays for one side based on the header mode.
 * - "default": diff[0] = header, diff[1..] = data (current behavior)
 * - "external": provided headers, diff[0..] = data (all rows are data)
 * - "loading": placeholder header, diff[0..] = data (all rows are data)
 */
function resolveHeaderAndData(
  diffRows: string[][],
  lineNumbers: Array<number | null>,
  mode?: SideHeaderMode,
): {
  headers: string[];
  data: string[][];
  lineNums: Array<number | null>;
  isLoading: boolean;
} {
  if (!mode || mode.mode === "default") {
    return {
      headers: diffRows[0] ?? [],
      data: diffRows.slice(1),
      lineNums: lineNumbers.slice(1),
      isLoading: false,
    };
  }
  if (mode.mode === "external") {
    return {
      headers: mode.headers ?? [],
      data: diffRows,
      lineNums: lineNumbers,
      isLoading: false,
    };
  }
  // loading
  return {
    headers: [],
    data: diffRows,
    lineNums: lineNumbers,
    isLoading: true,
  };
}

function setTextWithBreaks(parent: HTMLElement, text: string): void {
  if (!text.includes("\n") && !text.includes("\r")) {
    parent.textContent = text;
    return;
  }
  appendTextWithBreaks(parent, text, true);
}

export function syncRowHeights(container: HTMLElement): void {
  if (!container.isConnected || !container.getClientRects().length) return;

  const tables = container.querySelectorAll<HTMLTableElement>(
    ".csv-diff-side table",
  );
  if (tables.length !== 2) return;

  const beforeRows = tables[0].querySelectorAll<HTMLTableRowElement>("tr");
  const afterRows = tables[1].querySelectorAll<HTMLTableRowElement>("tr");
  const len = Math.min(beforeRows.length, afterRows.length);

  // Clear pass
  for (let i = 0; i < len; i++) {
    beforeRows[i].style.height = "";
    afterRows[i].style.height = "";
  }

  // Read pass — collect natural heights
  const heights: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    heights[i] = Math.max(
      beforeRows[i].offsetHeight,
      afterRows[i].offsetHeight,
    );
  }

  // Write pass — apply heights
  for (let i = 0; i < len; i++) {
    const h = `${heights[i]}px`;
    beforeRows[i].style.height = h;
    afterRows[i].style.height = h;
  }
}

export function renderDiffTable(
  diff: CsvDiff,
  options?: RenderOptions,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "csv-diff-container";

  const before = resolveHeaderAndData(
    diff.before,
    diff.beforeLineNumbers,
    options?.before,
  );
  const after = resolveHeaderAndData(
    diff.after,
    diff.afterLineNumbers,
    options?.after,
  );

  const maxCols = Math.max(
    before.headers.length,
    after.headers.length,
    ...before.data.map((row) => row.length),
    ...after.data.map((row) => row.length),
  );

  const matched = matchRows(
    before.data,
    after.data,
    before.lineNums,
    after.lineNums,
  );

  container.appendChild(
    buildSide(
      "Before",
      before.headers,
      matched,
      "before",
      maxCols,
      before.isLoading,
    ),
  );
  container.appendChild(
    buildSide(
      "After",
      after.headers,
      matched,
      "after",
      maxCols,
      after.isLoading,
    ),
  );

  highlightChangedCells(container, matched);

  // Synchronize horizontal scroll between Before and After sides
  const sides = container.querySelectorAll<HTMLElement>(".csv-diff-side");
  if (sides.length === 2) {
    let syncing = false;
    for (const side of sides) {
      side.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        const other = side === sides[0] ? sides[1] : sides[0];
        other.scrollLeft = side.scrollLeft;
        syncing = false;
      });
    }
  }

  return container;
}

function buildSide(
  label: string,
  headers: string[],
  matched: MatchedRow[],
  side: "before" | "after",
  maxCols: number,
  isLoading = false,
): HTMLElement {
  const sideDiv = document.createElement("div");
  sideDiv.className = "csv-diff-side";

  const headerDiv = document.createElement("div");
  headerDiv.className = "csv-diff-header";
  headerDiv.textContent = label;
  sideDiv.appendChild(headerDiv);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  if (isLoading) {
    // Loading placeholder: single cell spanning all columns (line-num + data cols)
    const th = document.createElement("th");
    th.colSpan = maxCols + 1; // +1 for line number column
    th.textContent = "Loading...";
    th.className = "csv-diff-loading";
    headerRow.appendChild(th);
  } else {
    // Line number header cell
    const lineNumTh = document.createElement("th");
    lineNumTh.className = "csv-diff-line-num";
    lineNumTh.textContent = "#";
    headerRow.appendChild(lineNumTh);

    for (let i = 0; i < maxCols; i++) {
      const th = document.createElement("th");
      setTextWithBreaks(th, i < headers.length ? headers[i] : "");
      headerRow.appendChild(th);
    }
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const match of matched) {
    const row = side === "before" ? match.before : match.after;
    const lineNum =
      side === "before" ? match.beforeLineNumber : match.afterLineNumber;
    const tr = document.createElement("tr");
    const isEmpty = row === null;

    if (isEmpty) {
      tr.className = "csv-diff-row-empty";
    } else if (match.type === "added" && side === "after") {
      tr.className = "csv-diff-row-added";
    } else if (match.type === "removed" && side === "before") {
      tr.className = "csv-diff-row-removed";
    }

    // Line number cell
    const lineNumTd = document.createElement("td");
    lineNumTd.className = "csv-diff-line-num";
    lineNumTd.textContent =
      !isEmpty && lineNum != null ? String(lineNum) : "\u00A0";
    tr.appendChild(lineNumTd);

    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement("td");
      if (isEmpty) {
        td.textContent = "\u00A0";
      } else {
        setTextWithBreaks(td, i < row.length ? row[i] : "");
      }
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  sideDiv.appendChild(table);
  return sideDiv;
}

function highlightChangedCells(
  container: HTMLElement,
  matched: MatchedRow[],
): void {
  const sides = container.querySelectorAll<HTMLElement>(".csv-diff-side");
  if (sides.length < 2) return;

  const beforeRows = sides[0].querySelectorAll("tbody tr");
  const afterRows = sides[1].querySelectorAll("tbody tr");

  for (let i = 0; i < matched.length; i++) {
    const match = matched[i];
    if (match.type !== "modified" || !match.before || !match.after) continue;

    const beforeTr = beforeRows[i];
    const afterTr = afterRows[i];
    if (!beforeTr || !afterTr) continue;

    // Style line number cells for modified rows
    const beforeLineNum = beforeTr.children[0] as HTMLElement | undefined;
    const afterLineNum = afterTr.children[0] as HTMLElement | undefined;
    if (beforeLineNum) beforeLineNum.classList.add("csv-diff-line-num-removed");
    if (afterLineNum) afterLineNum.classList.add("csv-diff-line-num-added");

    const maxCols = Math.max(match.before.length, match.after.length);
    for (let c = 0; c < maxCols; c++) {
      const beforeVal = c < match.before.length ? match.before[c] : "";
      const afterVal = c < match.after.length ? match.after[c] : "";
      if (beforeVal === afterVal) continue;

      // +1 offset to skip the line number cell at children[0]
      const beforeTd = beforeTr.children[c + 1] as HTMLElement | undefined;
      const afterTd = afterTr.children[c + 1] as HTMLElement | undefined;
      if (beforeTd) beforeTd.classList.add("csv-diff-cell-removed");
      if (afterTd) afterTd.classList.add("csv-diff-cell-changed");

      const changes =
        beforeTd && afterTd ? computeInlineDiff(beforeVal, afterVal) : null;
      if (beforeTd && afterTd && changes) {
        beforeTd.textContent = "";
        beforeTd.appendChild(renderInlineBefore(changes));
        afterTd.textContent = "";
        afterTd.appendChild(renderInlineAfter(changes));
      }
    }
  }
}

// --- Row matching ---

function lineNumAt(nums: Array<number | null>, i: number): number | null {
  return nums[i] ?? null;
}

export function matchRows(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): MatchedRow[] {
  if (isFirstColumnKey(before, after)) {
    return matchByKey(before, after, beforeLineNums, afterLineNums);
  }
  return matchByOrder(before, after, beforeLineNums, afterLineNums);
}

function isFirstColumnKey(before: string[][], after: string[][]): boolean {
  if (before.length === 0 && after.length === 0) return false;

  const beforeKeys = before.map((r) => r[0] ?? "");
  const afterKeys = after.map((r) => r[0] ?? "");

  // Check uniqueness
  if (new Set(beforeKeys).size !== beforeKeys.length) return false;
  if (new Set(afterKeys).size !== afterKeys.length) return false;

  // Check overlap
  const beforeSet = new Set(beforeKeys);
  const overlap = afterKeys.filter((k) => beforeSet.has(k)).length;
  const maxLen = Math.max(beforeKeys.length, afterKeys.length);
  return maxLen > 0 && overlap / maxLen >= 0.3;
}

function matchByKey(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): MatchedRow[] {
  const beforeMap = new Map<string, string[]>();
  for (const row of before) beforeMap.set(row[0] ?? "", row);

  const afterIndex = new Map<string, number>();
  for (let i = 0; i < after.length; i++) {
    afterIndex.set(after[i][0] ?? "", i);
  }

  const result: MatchedRow[] = [];
  let nextAfterFlush = 0;

  for (let bi = 0; bi < before.length; bi++) {
    const beforeRow = before[bi];
    const key = beforeRow[0] ?? "";
    const ai = afterIndex.get(key);

    if (ai !== undefined) {
      // Flush after-only rows that precede this matched position
      for (let j = nextAfterFlush; j < ai; j++) {
        const afterKey = after[j][0] ?? "";
        if (!beforeMap.has(afterKey)) {
          result.push({
            before: null,
            after: after[j],
            type: "added",
            beforeLineNumber: null,
            afterLineNumber: lineNumAt(afterLineNums, j),
          });
        }
      }
      nextAfterFlush = Math.max(nextAfterFlush, ai + 1);

      const equal = arraysEqual(beforeRow, after[ai]);
      result.push({
        before: beforeRow,
        after: after[ai],
        type: equal ? "unchanged" : "modified",
        beforeLineNumber: lineNumAt(beforeLineNums, bi),
        afterLineNumber: lineNumAt(afterLineNums, ai),
      });
    } else {
      result.push({
        before: beforeRow,
        after: null,
        type: "removed",
        beforeLineNumber: lineNumAt(beforeLineNums, bi),
        afterLineNumber: null,
      });
    }
  }

  // Flush remaining after-only rows
  for (let j = nextAfterFlush; j < after.length; j++) {
    const afterKey = after[j][0] ?? "";
    if (!beforeMap.has(afterKey)) {
      result.push({
        before: null,
        after: after[j],
        type: "added",
        beforeLineNumber: null,
        afterLineNumber: lineNumAt(afterLineNums, j),
      });
    }
  }

  return result;
}

function matchByOrder(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): MatchedRow[] {
  const result: MatchedRow[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = i < before.length ? before[i] : null;
    const a = i < after.length ? after[i] : null;

    if (b && a) {
      const equal = arraysEqual(b, a);
      result.push({
        before: b,
        after: a,
        type: equal ? "unchanged" : "modified",
        beforeLineNumber: lineNumAt(beforeLineNums, i),
        afterLineNumber: lineNumAt(afterLineNums, i),
      });
    } else if (b) {
      result.push({
        before: b,
        after: null,
        type: "removed",
        beforeLineNumber: lineNumAt(beforeLineNums, i),
        afterLineNumber: null,
      });
    } else if (a) {
      result.push({
        before: null,
        after: a,
        type: "added",
        beforeLineNumber: null,
        afterLineNumber: lineNumAt(afterLineNums, i),
      });
    }
  }

  return result;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
