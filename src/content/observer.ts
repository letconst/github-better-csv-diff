/**
 * MutationObserver that watches for CSV diff blocks in the GitHub DOM.
 * Handles SPA navigation by connecting/disconnecting based on route.
 * Supports PR pages, commit pages, and both Preview UI and Classic UI.
 */

import type { CsvDiff } from "../parser/diffParser";
import {
  diffToCsv,
  extractDiffLinesFromDom,
  getFirstLineNumbers,
} from "../parser/diffParser";
import { CLASSIC_UI, PREVIEW_UI, type UiConfig } from "../parser/uiConfig";
import {
  type RenderOptions,
  renderDiffTable,
  type SideHeaderMode,
} from "../renderer/tableRenderer";
import { clearHeaderCache, fetchCsvHeaderRow } from "./headerFetcher";
import {
  clearRevisionContextCache,
  getRevisionContext,
} from "./revisionContext";
import { isDiffRoute } from "./routes";

type CancellableCallback = MutationCallback & { cancel: () => void };

const PROCESSED_ATTR = "data-csv-diff-processed";
const CSV_EXTENSIONS = [".csv", ".tsv"];

let observer: MutationObserver | null = null;
let debouncedCallback: CancellableCallback | null = null;
// biome-ignore lint/correctness/noUnusedVariables: retained for future teardown
let urlPollTimer: ReturnType<typeof setInterval> | null = null;
let lifecycleInitialized = false;

export function initObserverLifecycle(): void {
  if (lifecycleInitialized) return;
  lifecycleInitialized = true;

  // Teardown BEFORE Turbo/PJAX swaps the page body
  document.addEventListener("turbo:before-render", disconnectObserver);
  document.addEventListener("turbo:before-cache", disconnectObserver);
  document.addEventListener("pjax:start", disconnectObserver);

  // Re-check route AFTER navigation completes
  document.addEventListener("turbo:load", syncObserverWithRoute);
  document.addEventListener("pjax:end", syncObserverWithRoute);
  window.addEventListener("popstate", syncObserverWithRoute);

  // Poll for URL changes that bypass Turbo/PJAX events (e.g. GitHub PR tab
  // switches via pushState in the main world, invisible to content script's
  // isolated world). Safe if DOM isn't ready: processExistingDiffs is idempotent,
  // and the MutationObserver will catch later inserts.
  urlPollTimer = watchUrlChanges(syncObserverWithRoute);

  // Initial route check
  syncObserverWithRoute();
}

function syncObserverWithRoute(): void {
  if (!isDiffRoute()) {
    disconnectObserver();
    return;
  }
  // Scan BEFORE connecting observer to avoid self-triggered debounced pass
  // (processExistingDiffs mutates DOM via wrapper/button injection)
  processExistingDiffs();
  connectObserver();
}

function connectObserver(): void {
  if (observer || !document.body) return;
  debouncedCallback = debounce(processExistingDiffs, 300);
  observer = new MutationObserver(debouncedCallback);
  observer.observe(document.body, { childList: true, subtree: true });
  console.debug(
    "[GitHub Better CSV Diff] Observer connected",
    location.pathname,
  );
}

function disconnectObserver(): void {
  // Cancel pending debounce even if observer is already null (fully idempotent)
  debouncedCallback?.cancel();
  debouncedCallback = null;
  // Clear cached revision context and header cache on navigation
  clearRevisionContextCache();
  clearHeaderCache();
  if (!observer) return;
  observer.disconnect();
  observer = null;
  console.debug("[GitHub Better CSV Diff] Observer disconnected");
}

function processExistingDiffs(): void {
  // Preview UI containers (PR + commit pages).
  // Use a broad selector so collapsed files (no table in DOM) are still found.
  // Non-diff regions are filtered out by the filename/CSV check below.
  const previewContainers =
    document.querySelectorAll<HTMLElement>('div[role="region"]');
  // Classic UI containers
  const classicContainers = document.querySelectorAll<HTMLElement>(
    "div.file.js-file[data-tagsearch-path]",
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
      ? (container.dataset.tagsearchPath ?? null)
      : getFilenameFromH3(container);
    if (!filename) continue;

    const isCsv = CSV_EXTENSIONS.some((ext) =>
      filename.toLowerCase().endsWith(ext),
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

  return (
    h3.textContent
      ?.replace(
        /\u200E|\u200F|\u2066|\u2067|\u2068|\u2069|\u200B|\u200C|\u200D|\uFEFF/g,
        "",
      )
      .trim() ?? null
  );
}

function processCsvDiffBlock(
  container: HTMLElement,
  config: UiConfig,
  filename: string,
): void {
  try {
    const diffLines = extractDiffLinesFromDom(container, config);
    if (diffLines.length === 0) {
      console.warn(
        "[GitHub Better CSV Diff] No diff lines extracted from",
        filename,
      );
      return;
    }

    const { firstBeforeLine, firstAfterLine } = getFirstLineNumbers(diffLines);
    const csvDiff = diffToCsv(diffLines);

    const needsBeforeHeader = firstBeforeLine !== null && firstBeforeLine !== 1;
    const needsAfterHeader = firstAfterLine !== null && firstAfterLine !== 1;

    if (!needsBeforeHeader && !needsAfterHeader) {
      // No header fetch needed — render as before
      const tableElement = renderDiffTable(csvDiff);
      if (injectTableOverlay(container, tableElement, config)) {
        container.setAttribute(PROCESSED_ATTR, "true");
      }
      return;
    }

    // At least one side needs a fetched header
    const ctx = getRevisionContext();
    const willFetchBefore = needsBeforeHeader && Boolean(ctx?.baseRef);
    const willFetchAfter = needsAfterHeader && Boolean(ctx?.headRef);
    const options = buildInitialRenderOptions(
      csvDiff,
      needsBeforeHeader,
      needsAfterHeader,
      willFetchBefore,
      willFetchAfter,
    );
    const tableElement = renderDiffTable(csvDiff, options);
    if (!injectTableOverlay(container, tableElement, config)) return;
    container.setAttribute(PROCESSED_ATTR, "true");

    if (!willFetchBefore && !willFetchAfter) {
      return;
    }

    // Async fetch headers and re-render
    const wrapper = container.querySelector(".csv-diff-wrapper");
    if (!wrapper || !ctx) return;

    fetchAndRerender({
      wrapper: wrapper as HTMLElement,
      csvDiff,
      owner: ctx.owner,
      repo: ctx.repo,
      baseRef: ctx.baseRef,
      headRef: ctx.headRef,
      filepath: filename,
      willFetchBefore,
      willFetchAfter,
      needsBeforeHeader,
      needsAfterHeader,
    });
  } catch (error) {
    console.error(
      "[GitHub Better CSV Diff] Error processing diff block:",
      filename,
      error,
    );
  }
}

function buildInitialRenderOptions(
  csvDiff: CsvDiff,
  needsBeforeHeader: boolean,
  needsAfterHeader: boolean,
  willFetchBefore: boolean,
  willFetchAfter: boolean,
): RenderOptions {
  // When a side doesn't need fetching, its first row can serve as a fallback
  // header for the other side (which does need fetching but can't).
  const fallbackFromBefore = !needsBeforeHeader
    ? (csvDiff.before[0] ?? null)
    : null;
  const fallbackFromAfter = !needsAfterHeader
    ? (csvDiff.after[0] ?? null)
    : null;

  return {
    before: determineInitialSideMode(
      needsBeforeHeader,
      willFetchBefore,
      willFetchAfter,
      fallbackFromAfter,
    ),
    after: determineInitialSideMode(
      needsAfterHeader,
      willFetchAfter,
      willFetchBefore,
      fallbackFromBefore,
    ),
  };
}

function determineInitialSideMode(
  needsHeader: boolean,
  willFetch: boolean,
  otherSideWillFetch: boolean,
  fallbackHeader: string[] | null,
): SideHeaderMode {
  if (!needsHeader) return { mode: "default" };
  if (willFetch || otherSideWillFetch) return { mode: "loading" };
  if (fallbackHeader) return { mode: "external", headers: fallbackHeader };
  return { mode: "default" };
}

interface FetchAndRerenderParams {
  wrapper: HTMLElement;
  csvDiff: CsvDiff;
  owner: string;
  repo: string;
  baseRef: string | null;
  headRef: string | null;
  filepath: string;
  willFetchBefore: boolean;
  willFetchAfter: boolean;
  needsBeforeHeader: boolean;
  needsAfterHeader: boolean;
}

async function fetchAndRerender(params: FetchAndRerenderParams): Promise<void> {
  const {
    wrapper,
    csvDiff,
    owner,
    repo,
    baseRef,
    headRef,
    filepath,
    willFetchBefore,
    willFetchAfter,
    needsBeforeHeader,
    needsAfterHeader,
  } = params;

  try {
    const [beforeHeader, afterHeader] = await Promise.all([
      willFetchBefore && baseRef
        ? fetchCsvHeaderRow(owner, repo, baseRef, filepath)
        : Promise.resolve(null),
      willFetchAfter && headRef
        ? fetchCsvHeaderRow(owner, repo, headRef, filepath)
        : Promise.resolve(null),
    ]);

    if (!wrapper.isConnected) return;

    const newTable = renderDiffTable(
      csvDiff,
      buildFinalRenderOptions(
        needsBeforeHeader,
        needsAfterHeader,
        beforeHeader,
        afterHeader,
      ),
    );

    const oldContainer = wrapper.querySelector(".csv-diff-container");
    if (oldContainer) {
      oldContainer.replaceWith(newTable);
    }
  } catch (error) {
    console.warn(
      "[GitHub Better CSV Diff] Header fetch/rerender failed:",
      filepath,
      error,
    );
  }
}

function buildFinalRenderOptions(
  needsBeforeHeader: boolean,
  needsAfterHeader: boolean,
  beforeHeader: string[] | null,
  afterHeader: string[] | null,
): RenderOptions {
  return {
    before: resolveFinalMode(needsBeforeHeader, beforeHeader, afterHeader),
    after: resolveFinalMode(needsAfterHeader, afterHeader, beforeHeader),
  };
}

/**
 * Determine the final SideHeaderMode after fetch resolution.
 * Priority: own fetched header > other side's header as fallback > default mode.
 * Falls back to "default" (diff[0] as header) only when neither side succeeded,
 * to avoid duplicating diff[0] in both header and body.
 */
function resolveFinalMode(
  needsHeader: boolean,
  ownHeader: string[] | null,
  otherHeader: string[] | null,
): SideHeaderMode {
  if (!needsHeader) return { mode: "default" };

  // If own fetch failed (null), fall back to other side's fetched header.
  // This handles Classic UI (baseRef unavailable) and fetch errors gracefully.
  const resolvedHeader = ownHeader ?? otherHeader;
  if (resolvedHeader) {
    return { mode: "external", headers: resolvedHeader };
  }
  return { mode: "default" };
}

/** Find the actions area in the header, with fallback for Preview UI. */
function findActionsArea(
  header: HTMLElement,
  config: UiConfig,
): HTMLElement | null {
  const area = header.querySelector<HTMLElement>(config.actionsSelector);
  if (area) return area;

  // Fallback for Preview UI: locate via the "Viewed" button (aria-pressed toggle)
  const viewedBtn = header.querySelector<HTMLElement>("button[aria-pressed]");
  if (viewedBtn?.textContent?.trim() === "Viewed" && viewedBtn.parentElement) {
    return viewedBtn.parentElement;
  }

  // Fallback for commit page: locate via "More options" button's parent container.
  // The button may use aria-label or aria-labelledby (PR commit pages use the latter).
  const moreBtn =
    header.querySelector<HTMLElement>('button[aria-label="More options"]') ??
    findButtonByTooltipText(header, "More options");
  if (moreBtn?.parentElement) {
    return moreBtn.parentElement;
  }

  // Fallback for Classic UI: use .file-actions container directly
  return header.querySelector<HTMLElement>(".file-actions");
}

/** Find a button whose aria-labelledby tooltip contains the given text. */
function findButtonByTooltipText(
  container: HTMLElement,
  text: string,
): HTMLElement | null {
  const buttons = container.querySelectorAll<HTMLElement>(
    "button[aria-labelledby]",
  );
  for (const btn of buttons) {
    const labelIds = btn.getAttribute("aria-labelledby");
    if (!labelIds) continue;
    // aria-labelledby can contain multiple space-separated IDs
    for (const id of labelIds.split(/\s+/)) {
      const label = document.getElementById(id);
      if (label?.textContent?.trim() === text) return btn;
    }
  }
  return null;
}

function createToggleButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "csv-diff-toggle-btn btn btn-sm csv-diff-toggle-active";
  btn.textContent = "Raw Diff";
  btn.type = "button";
  return btn;
}

function insertToggleButton(
  header: HTMLElement,
  config: UiConfig,
  btn: HTMLButtonElement,
): void {
  const actionsArea = findActionsArea(header, config);
  if (actionsArea) {
    actionsArea.prepend(btn);
  } else {
    header.appendChild(btn);
  }
}

/** Insert a toggle button into the header (used as placeholder when file is collapsed). */
function ensurePlaceholderToggle(
  container: HTMLElement,
  config: UiConfig,
): void {
  if (container.querySelector(".csv-diff-toggle-btn")) return;

  const header = container.querySelector<HTMLElement>(config.headerSelector);
  if (!header) return;

  const btn = createToggleButton();
  btn.classList.remove("csv-diff-toggle-active");
  btn.disabled = true;
  btn.setAttribute("aria-disabled", "true");
  btn.title = "Expand the file to enable CSV table view";
  insertToggleButton(header, config, btn);
}

function injectTableOverlay(
  container: HTMLElement,
  tableElement: HTMLElement,
  config: UiConfig,
): boolean {
  const header = container.querySelector<HTMLElement>(config.headerSelector);
  const diffBody = container.querySelector<HTMLElement>(config.contentSelector);

  if (!header || !diffBody) {
    console.warn(
      "[GitHub Better CSV Diff] Could not find header/body in container",
    );
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

  const toggleBtn = createToggleButton();

  toggleBtn.addEventListener("click", () => {
    const isTableVisible = wrapper.style.display !== "none";
    wrapper.style.display = isTableVisible ? "none" : "";
    setOriginalChildrenVisible(isTableVisible);
    toggleBtn.textContent = isTableVisible ? "Table View" : "Raw Diff";
    toggleBtn.classList.toggle("csv-diff-toggle-active", !isTableVisible);
    // Toggle raw-mode attribute so CSS stops hiding original content
    container.toggleAttribute("data-csv-diff-raw", isTableVisible);
  });

  insertToggleButton(header, config, toggleBtn);

  // Place wrapper inside diffBody so collapsing the file hides it too
  setOriginalChildrenVisible(false);
  diffBody.prepend(wrapper);
  return true;
}

/**
 * Poll for pathname changes to detect SPA navigations invisible to the content
 * script's isolated world (e.g. pushState called by the page's main world).
 * Compares pathname only — query/hash changes don't affect route gating.
 */
function watchUrlChanges(
  onNavigate: () => void,
): ReturnType<typeof setInterval> {
  let lastPathname = location.pathname;
  return setInterval(() => {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      onNavigate();
    }
  }, 500);
}

function debounce(fn: () => void, delayMs: number): CancellableCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const invoke = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return Object.assign(invoke, { cancel }) as CancellableCallback;
}
