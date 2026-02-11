/**
 * MutationObserver that watches for CSV diff blocks in the GitHub PR DOM.
 * Handles SPA navigation by re-scanning when new diff containers appear.
 * Supports both Preview UI (/changes) and Classic UI (/files).
 */

import { extractDiffLinesFromDom, diffToCsv } from "../parser/diffParser";
import { renderDiffTable } from "../renderer/tableRenderer";
import { PREVIEW_UI, CLASSIC_UI, type UiConfig } from "../parser/uiConfig";

const PROCESSED_ATTR = "data-csv-diff-processed";
const CSV_EXTENSIONS = [".csv", ".tsv"];

export function observeDiffContainers(): void {
  processExistingDiffs();

  const observer = new MutationObserver(debounce(processExistingDiffs, 300));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // SPA navigation backup (GitHub uses Turbo / PJAX)
  document.addEventListener("turbo:load", processExistingDiffs);
  document.addEventListener("pjax:end", processExistingDiffs);

  console.log("[GitHub Better CSV Diff] Observer initialized");
}

function processExistingDiffs(): void {
  // Preview UI containers
  const previewContainers = document.querySelectorAll<HTMLElement>(
    'div[id^="diff-"][role="region"]'
  );
  // Classic UI containers
  const classicContainers = document.querySelectorAll<HTMLElement>(
    "div.file.js-file[data-tagsearch-path]"
  );

  for (const container of [...previewContainers, ...classicContainers]) {
    if (container.hasAttribute(PROCESSED_ATTR)) {
      // Wrapper still present — nothing to do
      if (container.querySelector(".csv-diff-wrapper")) continue;

      // Wrapper is gone (GitHub rebuilt diffBody on collapse/re-expand).
      // Keep PROCESSED_ATTR so CSS hides raw diff on re-expand.
      container.removeAttribute("data-csv-diff-raw");
    }

    const isClassic = container.hasAttribute("data-tagsearch-path");
    const config = isClassic ? CLASSIC_UI : PREVIEW_UI;

    const filename = isClassic
      ? container.dataset.tagsearchPath ?? null
      : getFilenameFromH3(container);
    if (!filename) continue;

    const isCsv = CSV_EXTENSIONS.some((ext) =>
      filename.toLowerCase().endsWith(ext)
    );
    if (!isCsv) continue;

    // Check if diff table is present (not collapsed)
    const table = container.querySelector(config.tableSelector);
    if (!table) {
      // Collapsed: if previously processed, keep a toggle button in the header
      if (container.hasAttribute(PROCESSED_ATTR)) {
        ensurePlaceholderToggle(container, config);
      }
      continue;
    }

    // Remove stale toggle button before (re-)processing
    container.querySelector(".csv-diff-toggle-btn")?.remove();
    processCsvDiffBlock(container, config, filename);
  }
}

/** Extract filename from Preview UI container's h3, stripping Unicode markers. */
function getFilenameFromH3(container: HTMLElement): string | null {
  const h3 = container.querySelector("h3");
  if (!h3) return null;

  return h3.textContent?.replace(/[\u200E\u200F\u2066\u2067\u2068\u2069\u200B\u200C\u200D\uFEFF]/g, "").trim() ?? null;
}

function processCsvDiffBlock(
  container: HTMLElement,
  config: UiConfig,
  filename: string
): void {
  try {
    const diffLines = extractDiffLinesFromDom(container, config);
    if (diffLines.length === 0) {
      console.warn(
        "[GitHub Better CSV Diff] No diff lines extracted from",
        filename
      );
      return;
    }

    const csvDiff = diffToCsv(diffLines);
    const tableElement = renderDiffTable(csvDiff);
    if (injectTableOverlay(container, tableElement, config)) {
      container.setAttribute(PROCESSED_ATTR, "true");
    }
  } catch (error) {
    console.error(
      "[GitHub Better CSV Diff] Error processing diff block:",
      filename,
      error
    );
  }
}

/** Find the actions area in the header, with fallback for Preview UI. */
function findActionsArea(
  header: HTMLElement,
  config: UiConfig
): HTMLElement | null {
  const area = header.querySelector<HTMLElement>(config.actionsSelector);
  if (area) return area;

  // Fallback: locate via the "Viewed" button (aria-pressed attribute)
  const viewedBtn = header.querySelector<HTMLElement>("button[aria-pressed]");
  return viewedBtn?.parentElement ?? null;
}

/** Insert a toggle button into the header (used as placeholder when file is collapsed). */
function ensurePlaceholderToggle(
  container: HTMLElement,
  config: UiConfig
): void {
  if (container.querySelector(".csv-diff-toggle-btn")) return;

  const header = container.querySelector<HTMLElement>(config.headerSelector);
  if (!header) return;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "csv-diff-toggle-btn btn btn-sm csv-diff-toggle-active";
  toggleBtn.textContent = "Raw Diff";
  toggleBtn.type = "button";

  const actionsArea = findActionsArea(header, config);
  if (actionsArea) {
    actionsArea.prepend(toggleBtn);
  } else {
    header.appendChild(toggleBtn);
  }
}

function injectTableOverlay(
  container: HTMLElement,
  tableElement: HTMLElement,
  config: UiConfig
): boolean {
  const header = container.querySelector<HTMLElement>(config.headerSelector);
  const diffBody = container.querySelector<HTMLElement>(config.contentSelector);

  if (!header || !diffBody) {
    console.warn("[GitHub Better CSV Diff] Could not find header/body in container");
    return false;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "csv-diff-wrapper";
  wrapper.appendChild(tableElement);

  // Snapshot original children before prepending wrapper
  const originalChildren = Array.from(diffBody.children) as HTMLElement[];

  function setOriginalChildrenVisible(visible: boolean): void {
    for (const child of originalChildren) {
      child.style.display = visible ? "" : "none";
    }
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "csv-diff-toggle-btn btn btn-sm csv-diff-toggle-active";
  toggleBtn.textContent = "Raw Diff";
  toggleBtn.type = "button";

  toggleBtn.addEventListener("click", () => {
    const isTableVisible = wrapper.style.display !== "none";
    wrapper.style.display = isTableVisible ? "none" : "";
    setOriginalChildrenVisible(isTableVisible);
    toggleBtn.textContent = isTableVisible ? "Table View" : "Raw Diff";
    toggleBtn.classList.toggle("csv-diff-toggle-active", !isTableVisible);
    // Toggle raw-mode attribute so CSS stops hiding original content
    container.toggleAttribute("data-csv-diff-raw", isTableVisible);
  });

  const actionsArea = findActionsArea(header, config);
  if (actionsArea) {
    actionsArea.prepend(toggleBtn);
  } else {
    header.appendChild(toggleBtn);
  }

  // Place wrapper inside diffBody so collapsing the file hides it too
  setOriginalChildrenVisible(false);
  diffBody.prepend(wrapper);
  return true;
}

function debounce(fn: () => void, delayMs: number): MutationCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}
