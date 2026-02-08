/**
 * Renders side-by-side (Before / After) diff tables from parsed CSV data.
 */

import type { CsvDiff } from "../parser/diffParser";

export function renderDiffTable(diff: CsvDiff): HTMLElement {
  // TODO: Implement side-by-side table rendering
  const container = document.createElement("div");
  container.className = "csv-diff-container";
  return container;
}
