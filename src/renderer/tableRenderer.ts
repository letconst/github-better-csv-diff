/**
 * Renders side-by-side (Before / After) diff tables from parsed CSV data.
 */

import type { CsvDiff } from "../parser/diffParser";
import {
  computeInlineDiff,
  renderInlineAfter,
  renderInlineBefore,
} from "./inlineDiff";

export interface MatchedRow {
  before: string[] | null;
  after: string[] | null;
  type: "added" | "removed" | "modified" | "unchanged";
}

export function renderDiffTable(diff: CsvDiff): HTMLElement {
  const container = document.createElement("div");
  container.className = "csv-diff-container";

  const beforeHeaders = diff.before[0] ?? [];
  const afterHeaders = diff.after[0] ?? [];
  const beforeData = diff.before.slice(1);
  const afterData = diff.after.slice(1);

  const maxCols = Math.max(
    beforeHeaders.length,
    afterHeaders.length,
    ...beforeData.map((row) => row.length),
    ...afterData.map((row) => row.length),
  );

  const matched = matchRows(beforeData, afterData);

  container.appendChild(
    buildSide("Before", beforeHeaders, matched, "before", maxCols),
  );
  container.appendChild(
    buildSide("After", afterHeaders, matched, "after", maxCols),
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

  for (let i = 0; i < maxCols; i++) {
    const th = document.createElement("th");
    th.textContent = i < headers.length ? headers[i] : "";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const match of matched) {
    const row = side === "before" ? match.before : match.after;
    const tr = document.createElement("tr");
    const isEmpty = row === null;

    if (isEmpty) {
      tr.className = "csv-diff-row-empty";
    } else if (match.type === "added" && side === "after") {
      tr.className = "csv-diff-row-added";
    } else if (match.type === "removed" && side === "before") {
      tr.className = "csv-diff-row-removed";
    }

    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement("td");
      if (isEmpty) {
        td.textContent = "\u00A0";
      } else {
        td.textContent = i < row.length ? row[i] : "";
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

    const maxCols = Math.max(match.before.length, match.after.length);
    for (let c = 0; c < maxCols; c++) {
      const beforeVal = c < match.before.length ? match.before[c] : "";
      const afterVal = c < match.after.length ? match.after[c] : "";
      if (beforeVal === afterVal) continue;

      const beforeTd = beforeTr.children[c] as HTMLElement | undefined;
      const afterTd = afterTr.children[c] as HTMLElement | undefined;
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

export function matchRows(before: string[][], after: string[][]): MatchedRow[] {
  if (isFirstColumnKey(before, after)) {
    return matchByKey(before, after);
  }
  return matchByOrder(before, after);
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

function matchByKey(before: string[][], after: string[][]): MatchedRow[] {
  const beforeMap = new Map<string, string[]>();
  for (const row of before) beforeMap.set(row[0] ?? "", row);

  const afterIndex = new Map<string, number>();
  for (let i = 0; i < after.length; i++) {
    afterIndex.set(after[i][0] ?? "", i);
  }

  const result: MatchedRow[] = [];
  let nextAfterFlush = 0;

  for (const beforeRow of before) {
    const key = beforeRow[0] ?? "";
    const ai = afterIndex.get(key);

    if (ai !== undefined) {
      // Flush after-only rows that precede this matched position
      for (let j = nextAfterFlush; j < ai; j++) {
        const afterKey = after[j][0] ?? "";
        if (!beforeMap.has(afterKey)) {
          result.push({ before: null, after: after[j], type: "added" });
        }
      }
      nextAfterFlush = Math.max(nextAfterFlush, ai + 1);

      const equal = arraysEqual(beforeRow, after[ai]);
      result.push({
        before: beforeRow,
        after: after[ai],
        type: equal ? "unchanged" : "modified",
      });
    } else {
      result.push({ before: beforeRow, after: null, type: "removed" });
    }
  }

  // Flush remaining after-only rows
  for (let j = nextAfterFlush; j < after.length; j++) {
    const afterKey = after[j][0] ?? "";
    if (!beforeMap.has(afterKey)) {
      result.push({ before: null, after: after[j], type: "added" });
    }
  }

  return result;
}

function matchByOrder(before: string[][], after: string[][]): MatchedRow[] {
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
      });
    } else if (b) {
      result.push({ before: b, after: null, type: "removed" });
    } else if (a) {
      result.push({ before: null, after: a, type: "added" });
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
