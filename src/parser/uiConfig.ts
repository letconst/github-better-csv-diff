/**
 * UI-specific selectors and helpers for parsing GitHub diff DOM.
 * Each config describes a GitHub UI variant (Preview vs Classic).
 */

export interface UiConfig {
  tableSelector: string;
  rowSelector: string;
  hunkClass: string;
  contextClass: string;
  emptyClass: string;
  /** Selector for the diff header element within the container. */
  headerSelector: string;
  /** Selector for the diff content/body element within the container. */
  contentSelector: string;
  /** Selector for the header actions area where the toggle button is inserted. */
  actionsSelector: string;
  /**
   * Selector for GitHub's own sticky file-header bar. The CSV column header pins
   * directly below it, so its rendered height drives the sticky-top offset.
   */
  stickyFileHeaderSelector: string;
  /** Selector for GitHub's native expand controls inside a hunk row. */
  expanderSelector: string;
  expanderDirection(el: HTMLElement): "up" | "down" | "all";
  extractContent(cell: HTMLTableCellElement): string;
  /** Extract text from a changed (added/removed) content cell, stripping diff marker if present. */
  extractChangedContent(cell: HTMLTableCellElement): string;
  /** Extract the line number from a line-number cell, or null if the cell is empty. */
  extractLineNumber(cell: HTMLTableCellElement): number | null;
}

export const PREVIEW_UI: UiConfig = {
  tableSelector: 'table[role="grid"]',
  rowSelector: "tr.diff-line-row",
  hunkClass: "diff-hunk-cell",
  contextClass: "diff-line-number-neutral",
  emptyClass: "empty-diff-line",
  headerSelector: ":scope > :first-child",
  contentSelector: ":scope > :nth-child(2)",
  actionsSelector: ':has(> [class*="MarkAsViewedButton"])',
  stickyFileHeaderSelector: 'div[class*="diffHeaderWrapper"]',
  expanderSelector: "button[data-direction]",
  expanderDirection: (el) => {
    const d = el.dataset.direction;
    return d === "up" || d === "down" ? d : "all";
  },
  extractContent: (cell) => cell.textContent ?? "",
  extractChangedContent: (cell) => {
    const text = cell.textContent ?? "";
    return text.startsWith("+") || text.startsWith("-") ? text.slice(1) : text;
  },
  extractLineNumber: (cell) => {
    const text = cell.textContent?.trim();
    if (!text) return null;
    const num = parseInt(text, 10);
    return Number.isNaN(num) ? null : num;
  },
};

// GitHub's expanded-context rows put .blob-code-inner on the <td> itself;
// ordinary diff rows wrap the text in a child span.
const classicCodeText = (cell: HTMLTableCellElement): string =>
  (cell.matches(".blob-code-inner")
    ? cell
    : cell.querySelector<HTMLElement>(".blob-code-inner")
  )?.textContent ?? "";

export const CLASSIC_UI: UiConfig = {
  tableSelector: "table.diff-table",
  rowSelector: "tbody tr",
  hunkClass: "blob-num-hunk",
  contextClass: "blob-num-context",
  emptyClass: "empty-cell",
  headerSelector: ".file-header",
  contentSelector: ".js-file-content",
  actionsSelector: ".file-actions > .d-flex",
  stickyFileHeaderSelector: ".file-header",
  expanderSelector: "a.js-expand",
  expanderDirection: (el) => {
    const label = el.getAttribute("aria-label");
    return label === "Expand Up"
      ? "up"
      : label === "Expand Down"
        ? "down"
        : "all";
  },
  extractContent: classicCodeText,
  extractChangedContent: classicCodeText,
  extractLineNumber: (cell) => {
    const attr = cell.getAttribute("data-line-number");
    if (attr == null) return null;
    const num = parseInt(attr, 10);
    return Number.isNaN(num) ? null : num;
  },
};
