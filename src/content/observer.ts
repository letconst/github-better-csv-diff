/**
 * MutationObserver that watches for CSV diff blocks in the GitHub PR DOM.
 * Handles SPA navigation by re-scanning when new diff containers appear.
 */

import { extractDiffLinesFromDom, diffToCsv } from "../parser/diffParser";
import { renderDiffTable } from "../renderer/tableRenderer";

const PROCESSED_ATTR = "data-csv-diff-processed";
const CSV_EXTENSIONS = [".csv", ".tsv"];

export function observeDiffContainers(): void {
  processExistingDiffs();

  const observer = new MutationObserver(debounce(processExistingDiffs, 300));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // SPA navigation backup (GitHub uses Turbo)
  document.addEventListener("turbo:load", processExistingDiffs);
  document.addEventListener("pjax:end", processExistingDiffs);

  console.log("[GitHub Better CSV Diff] Observer initialized");
}

function processExistingDiffs(): void {
  const containers = document.querySelectorAll<HTMLElement>(
    'div[id^="diff-"][role="region"]'
  );

  for (const container of containers) {
    if (container.hasAttribute(PROCESSED_ATTR)) continue;

    const filename = getFilename(container);
    if (!filename) continue;

    const isCsv = CSV_EXTENSIONS.some((ext) =>
      filename.toLowerCase().endsWith(ext)
    );
    if (!isCsv) continue;

    // Check if diff table is present (not collapsed)
    const table = container.querySelector('table[role="grid"]');
    if (!table) continue;

    container.setAttribute(PROCESSED_ATTR, "true");
    processCsvDiffBlock(container);
  }
}

function getFilename(container: HTMLElement): string | null {
  const h3 = container.querySelector("h3");
  if (!h3) return null;

  // Remove Unicode directional/formatting markers (LRM, RLM, LRI, RLI, FSI, PDI, etc.)
  return h3.textContent?.replace(/[\u200E\u200F\u2066\u2067\u2068\u2069\u200B\u200C\u200D\uFEFF]/g, "").trim() ?? null;
}

function processCsvDiffBlock(container: HTMLElement): void {
  try {
    const diffLines = extractDiffLinesFromDom(container);
    if (diffLines.length === 0) {
      console.warn(
        "[GitHub Better CSV Diff] No diff lines extracted from",
        getFilename(container)
      );
      return;
    }

    const csvDiff = diffToCsv(diffLines);
    const tableElement = renderDiffTable(csvDiff);
    injectTableOverlay(container, tableElement);
  } catch (error) {
    console.error(
      "[GitHub Better CSV Diff] Error processing diff block:",
      getFilename(container),
      error
    );
  }
}

function injectTableOverlay(
  container: HTMLElement,
  tableElement: HTMLElement
): void {
  const header = container.children[0] as HTMLElement | undefined;
  const diffBody = container.children[1] as HTMLElement | undefined;
  if (!header || !diffBody) {
    console.warn("[GitHub Better CSV Diff] Could not find header/body in container");
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "csv-diff-wrapper";
  wrapper.appendChild(tableElement);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "csv-diff-toggle-btn btn btn-sm csv-diff-toggle-active";
  toggleBtn.textContent = "Raw Diff";
  toggleBtn.type = "button";

  toggleBtn.addEventListener("click", () => {
    const isTableVisible = wrapper.style.display !== "none";
    wrapper.style.display = isTableVisible ? "none" : "";
    diffBody.style.display = isTableVisible ? "" : "none";
    toggleBtn.textContent = isTableVisible ? "Table View" : "Raw Diff";
    toggleBtn.classList.toggle("csv-diff-toggle-active", !isTableVisible);
  });

  const actionsArea = header.querySelector(
    '[class*="diffHeaderActionWrapper"], [class*="ActionGroup"]'
  );
  if (actionsArea) {
    actionsArea.prepend(toggleBtn);
  } else {
    header.appendChild(toggleBtn);
  }

  // Show table view by default, hide raw diff
  container.insertBefore(wrapper, diffBody);
  diffBody.style.display = "none";
}

function debounce(fn: () => void, delayMs: number): MutationCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}
