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
import { type MatchedRow, matchRows } from "./rowMatcher";

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
  parent.textContent = "";
  appendTextWithBreaks(parent, text, true);
}

export function syncRowHeights(container: HTMLElement): void {
  if (!container.isConnected || !container.getClientRects().length) return;

  const tables = container.querySelectorAll<HTMLTableElement>(
    ".csv-diff-body-table",
  );
  if (tables.length !== 2) return;

  const beforeRows = tables[0]!.querySelectorAll<HTMLTableRowElement>("tr");
  const afterRows = tables[1]!.querySelectorAll<HTMLTableRowElement>("tr");
  const len = Math.min(beforeRows.length, afterRows.length);

  // Clear pass
  for (let i = 0; i < len; i++) {
    beforeRows[i]!.style.height = "";
    afterRows[i]!.style.height = "";
  }

  // Read pass — collect natural heights
  const heights: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    heights[i] = Math.max(
      beforeRows[i]!.offsetHeight,
      afterRows[i]!.offsetHeight,
    );
  }

  // Write pass — apply heights
  for (let i = 0; i < len; i++) {
    const h = `${heights[i]}px`;
    beforeRows[i]!.style.height = h;
    afterRows[i]!.style.height = h;
  }
}

/**
 * Align each side's frozen header table columns with its body table columns.
 * Header and body live in separate tables (so the header can escape the body's
 * scroll container and stick to the viewport), so their column widths must be
 * synced explicitly. Runs per side independently — Before/After widths need not
 * match; only the intra-side header↔body columns must align.
 *
 * Must run after the container is inserted into the document; both this and
 * syncRowHeights are connectivity-gated and no-op on a detached node.
 */
export function syncColumnWidths(container: HTMLElement): void {
  if (!container.isConnected || !container.getClientRects().length) return;

  const sides = container.querySelectorAll<HTMLElement>(".csv-diff-side");
  for (const side of sides) {
    const headerTable = side.querySelector<HTMLTableElement>(
      ".csv-diff-header-table",
    );
    const bodyTable = side.querySelector<HTMLTableElement>(
      ".csv-diff-body-table",
    );
    if (!headerTable || !bodyTable) continue;

    const headerCols = headerTable.querySelectorAll<HTMLTableColElement>("col");
    const bodyCols = bodyTable.querySelectorAll<HTMLTableColElement>("col");
    const n = headerCols.length;
    if (n === 0 || n !== bodyCols.length) continue;

    // Clear pass — drop fixed layout and any width applied by a prior pass so
    // the read pass measures true natural widths, not stale constrained ones.
    for (const table of [headerTable, bodyTable]) {
      table.style.tableLayout = "auto";
      table.style.width = "";
    }
    for (const col of [...headerCols, ...bodyCols]) col.style.width = "";

    // Read pass — per column, max(header, first body row) to avoid clipping.
    const headerCells = Array.from(
      headerTable.querySelectorAll<HTMLTableCellElement>("thead tr > *"),
    );
    // The loading header is a single th[colSpan=n], which doesn't map 1:1 to
    // columns — its width would wrongly drive column 0 to the full table width.
    // Measure from the body alone while any header cell spans multiple columns.
    const hasSpanningHeaderCell = headerCells.some((cell) => cell.colSpan > 1);
    const bodyCells =
      bodyTable.querySelector<HTMLTableRowElement>("tbody tr")?.children ??
      null;
    const widths = new Array<number>(n);
    for (let c = 0; c < n; c++) {
      const headerWidth = hasSpanningHeaderCell
        ? 0
        : (headerCells[c]?.getBoundingClientRect().width ?? 0);
      const bodyCell = bodyCells?.[c] as HTMLElement | undefined;
      const bodyWidth = bodyCell?.getBoundingClientRect().width ?? 0;
      widths[c] = Math.ceil(Math.max(headerWidth, bodyWidth));
    }

    // Fill the side's width when the natural columns are narrower than the
    // available space (restoring the old width:100% behaviour) by distributing
    // the slack across the data columns proportionally to their natural width;
    // the line-number column (index 0) stays narrow. When the natural columns
    // overflow, leave them as-is so the body scrolls horizontally.
    const naturalTotal = widths.reduce((sum, w) => sum + w, 0);
    const available = bodyTable.parentElement?.clientWidth ?? 0;
    const dataCount = n - 1;
    if (available > naturalTotal && dataCount > 0) {
      const slack = available - naturalTotal;
      const dataTotal = naturalTotal - widths[0]!;
      let distributed = 0;
      for (let c = 1; c < n; c++) {
        // Give the remainder to the last data column so columns sum exactly.
        const add =
          c === n - 1
            ? slack - distributed
            : dataTotal > 0
              ? Math.round((slack * widths[c]!) / dataTotal)
              : Math.round(slack / dataCount);
        widths[c]! += add;
        distributed += add;
      }
    }

    // Write pass — identical per-column + total widths on both tables, fixed
    // layout, so their horizontal scroll ranges match exactly.
    let total = 0;
    for (let c = 0; c < n; c++) {
      const w = `${widths[c]}px`;
      headerCols[c]!.style.width = w;
      bodyCols[c]!.style.width = w;
      total += widths[c]!;
    }
    for (const table of [headerTable, bodyTable]) {
      table.style.tableLayout = "fixed";
      table.style.width = `${total}px`;
    }
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
    diff.alignment,
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

  // Synchronize horizontal scroll between Before and After sides. The body is
  // the only horizontal scroll container; mirror its scrollLeft to the other
  // body AND to both header strips (overflow:hidden, scrolled programmatically)
  // so the frozen headers track their columns. scrollLeft only — a whole-table
  // transform would drag the sticky-left line-number column off too.
  const bodies = container.querySelectorAll<HTMLElement>(".csv-diff-body");
  const strips = container.querySelectorAll<HTMLElement>(
    ".csv-diff-header-strip",
  );
  if (bodies.length === 2) {
    let syncing = false;
    for (const body of bodies) {
      body.addEventListener(
        "scroll",
        () => {
          if (syncing) return;
          syncing = true;
          const left = body.scrollLeft;
          for (const other of bodies) {
            if (other !== body) other.scrollLeft = left;
          }
          for (const strip of strips) strip.scrollLeft = left;
          syncing = false;
        },
        { passive: true },
      );
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

  // Header and body are separate tables so the header strip can escape the
  // body's horizontal scroll container and stick to the viewport. Their column
  // widths are aligned at runtime by syncColumnWidths.
  sideDiv.appendChild(buildHeaderTable(headers, maxCols, isLoading));
  sideDiv.appendChild(buildBodyTable(matched, side, maxCols));
  return sideDiv;
}

/** Append a `<colgroup>` of `colCount` `<col>` elements as the table's width carrier. */
function appendColgroup(table: HTMLTableElement, colCount: number): void {
  const colgroup = document.createElement("colgroup");
  for (let i = 0; i < colCount; i++) {
    colgroup.appendChild(document.createElement("col"));
  }
  table.appendChild(colgroup);
}

/** Build the sticky header strip containing the column-header table. */
function buildHeaderTable(
  headers: string[],
  maxCols: number,
  isLoading: boolean,
): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "csv-diff-header-strip";

  const table = document.createElement("table");
  table.className = "csv-diff-header-table";
  const colCount = maxCols + 1; // +1 for the line number column
  appendColgroup(table, colCount);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  if (isLoading) {
    const th = document.createElement("th");
    th.colSpan = colCount;
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
      setTextWithBreaks(th, i < headers.length ? headers[i]! : "");
      headerRow.appendChild(th);
    }
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  strip.appendChild(table);
  return strip;
}

/** Build the horizontally-scrollable body containing the data-row table. */
function buildBodyTable(
  matched: MatchedRow[],
  side: "before" | "after",
  maxCols: number,
): HTMLElement {
  const bodyDiv = document.createElement("div");
  bodyDiv.className = "csv-diff-body";

  const table = document.createElement("table");
  table.className = "csv-diff-body-table";
  const colCount = maxCols + 1; // +1 for the line number column
  appendColgroup(table, colCount);

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
        setTextWithBreaks(td, i < row.length ? row[i]! : "");
      }
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  bodyDiv.appendChild(table);
  return bodyDiv;
}

function highlightChangedCells(
  container: HTMLElement,
  matched: MatchedRow[],
): void {
  const sides = container.querySelectorAll<HTMLElement>(".csv-diff-side");
  if (sides.length < 2) return;

  const beforeRows = sides[0]!.querySelectorAll("tbody tr");
  const afterRows = sides[1]!.querySelectorAll("tbody tr");

  for (let i = 0; i < matched.length; i++) {
    const match = matched[i]!;
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
      const beforeVal = c < match.before.length ? match.before[c]! : "";
      const afterVal = c < match.after.length ? match.after[c]! : "";
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
