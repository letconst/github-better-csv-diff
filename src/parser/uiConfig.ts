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
  extractContent(cell: HTMLTableCellElement): string;
}

export const PREVIEW_UI: UiConfig = {
  tableSelector: 'table[role="grid"]',
  rowSelector: "tr.diff-line-row",
  hunkClass: "diff-hunk-cell",
  contextClass: "diff-line-number-neutral",
  emptyClass: "empty-diff-line",
  headerSelector: ":scope > :first-child",
  contentSelector: ":scope > :nth-child(2)",
  actionsSelector:
    '[class*="diffHeaderActionWrapper"], [class*="ActionGroup"]',
  extractContent: (cell) => cell.textContent ?? "",
};

export const CLASSIC_UI: UiConfig = {
  tableSelector: "table.diff-table",
  rowSelector: "tbody tr",
  hunkClass: "blob-num-hunk",
  contextClass: "blob-num-context",
  emptyClass: "empty-cell",
  headerSelector: ".file-header",
  contentSelector: ".js-file-content",
  actionsSelector: ".file-actions",
  extractContent: (cell) =>
    cell.querySelector<HTMLElement>(".blob-code-inner")?.textContent ?? "",
};
