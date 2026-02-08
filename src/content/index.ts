/**
 * Content script entry point.
 * Injected on GitHub PR "Files changed" pages.
 * Observes DOM mutations to detect CSV diff blocks and injects table overlays.
 */

import "../styles/diff-table.css";
import { observeDiffContainers } from "./observer";

console.log("[GitHub Better CSV Diff] Content script loaded");

observeDiffContainers();
