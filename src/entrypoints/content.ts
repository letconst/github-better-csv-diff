/**
 * Content script entry point.
 * Injected on GitHub pages to detect CSV diff blocks (PRs, commits, etc.)
 * and inject table overlays.
 */

import "../styles/diff-table.css";
import { initObserverLifecycle } from "../content/observer";

export default defineContentScript({
  matches: ["https://github.com/*"],
  main() {
    console.log("[GitHub Better CSV Diff] Content script loaded");
    initObserverLifecycle();
  },
});
