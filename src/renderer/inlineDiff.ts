import { type Change, diffChars, diffWordsWithSpace } from "diff";

const inlineDiffThreshold = 0.8;
const charFallbackThreshold = 0.6;

function unchangedRatio(
  changes: Change[],
  before: string,
  after: string,
): number {
  let unchangedChars = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      unchangedChars += change.value.length;
    }
  }
  const maxLen = Math.max(before.length, after.length);
  return maxLen === 0 ? 0 : unchangedChars / maxLen;
}

/**
 * Computes inline diff changes between two cell values.
 * Tries word-level diff first; falls back to character-level diff
 * for single-token values (IDs, emails, codes without spaces).
 * Returns null if either value is empty, or if both word- and char-level
 * diffs exceed the configured change thresholds.
 */
export function computeInlineDiff(
  before: string,
  after: string,
): Change[] | null {
  if (before === "" || after === "") return null;

  const wordChanges = diffWordsWithSpace(before, after);
  if (unchangedRatio(wordChanges, before, after) >= 1 - inlineDiffThreshold)
    return wordChanges;

  const charChanges = diffChars(before, after);
  if (unchangedRatio(charChanges, before, after) >= charFallbackThreshold)
    return charChanges;

  return null;
}

function createNewlineIndicator(extraClass?: string): HTMLSpanElement {
  const indicator = document.createElement("span");
  indicator.className = extraClass
    ? `csv-diff-newline-indicator ${extraClass}`
    : "csv-diff-newline-indicator";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function containsNewline(text: string): boolean {
  return text.includes("\n") || text.includes("\r");
}

export function appendTextWithBreaks(
  parent: DocumentFragment | HTMLElement,
  text: string,
  showIndicator = false,
): void {
  if (!containsNewline(text)) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  const parts = splitLines(text);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      if (showIndicator) {
        parent.appendChild(createNewlineIndicator());
      }
      parent.appendChild(document.createElement("br"));
    }
    parent.appendChild(document.createTextNode(parts[i]));
  }
}

/**
 * Appends highlighted text segments to a fragment, splitting by newlines so
 * that newline indicators and <br> elements sit outside the highlight spans.
 */
function appendHighlightedWithBreaks(
  fragment: DocumentFragment,
  text: string,
  className: string,
): void {
  const parts = splitLines(text);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      fragment.appendChild(createNewlineIndicator(className));
      fragment.appendChild(document.createElement("br"));
    }
    const span = document.createElement("span");
    span.className = className;
    span.appendChild(document.createTextNode(parts[i]));
    fragment.appendChild(span);
  }
}

/**
 * Builds DOM nodes for a "before" (deletion) cell with inline diff spans.
 * Removed segments are wrapped in <span class="csv-diff-inline-removed">.
 */
export function renderInlineBefore(changes: Change[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const change of changes) {
    if (change.added) continue;
    if (change.removed) {
      appendHighlightedWithBreaks(
        fragment,
        change.value,
        "csv-diff-inline-removed",
      );
    } else {
      appendTextWithBreaks(fragment, change.value, true);
    }
  }

  return fragment;
}

/**
 * Builds DOM nodes for an "after" (addition) cell with inline diff spans.
 * Added segments are wrapped in <span class="csv-diff-inline-added">.
 */
export function renderInlineAfter(changes: Change[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const change of changes) {
    if (change.removed) continue;
    if (change.added) {
      appendHighlightedWithBreaks(
        fragment,
        change.value,
        "csv-diff-inline-added",
      );
    } else {
      appendTextWithBreaks(fragment, change.value, true);
    }
  }

  return fragment;
}
