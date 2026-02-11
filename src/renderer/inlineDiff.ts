import { diffWordsWithSpace } from "diff";

const inlineDiffThreshold = 0.8;

/**
 * Determines whether inline highlighting should be applied.
 * Returns false if either value is empty or if >80% of content changed.
 */
export function shouldInlineHighlight(
  before: string,
  after: string
): boolean {
  if (before === "" || after === "") return false;

  const changes = diffWordsWithSpace(before, after);

  let unchangedChars = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      unchangedChars += change.value.length;
    }
  }

  const maxLen = Math.max(before.length, after.length);
  return unchangedChars / maxLen >= 1 - inlineDiffThreshold;
}

/**
 * Builds DOM nodes for a "before" (deletion) cell with inline diff spans.
 * Removed segments are wrapped in <span class="csv-diff-inline-removed">.
 */
export function renderInlineBefore(
  before: string,
  after: string
): DocumentFragment {
  const changes = diffWordsWithSpace(before, after);
  const fragment = document.createDocumentFragment();

  for (const change of changes) {
    if (change.added) continue;
    if (change.removed) {
      const span = document.createElement("span");
      span.className = "csv-diff-inline-removed";
      span.textContent = change.value;
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(change.value));
    }
  }

  return fragment;
}

/**
 * Builds DOM nodes for an "after" (addition) cell with inline diff spans.
 * Added segments are wrapped in <span class="csv-diff-inline-added">.
 */
export function renderInlineAfter(
  before: string,
  after: string
): DocumentFragment {
  const changes = diffWordsWithSpace(before, after);
  const fragment = document.createDocumentFragment();

  for (const change of changes) {
    if (change.removed) continue;
    if (change.added) {
      const span = document.createElement("span");
      span.className = "csv-diff-inline-added";
      span.textContent = change.value;
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(change.value));
    }
  }

  return fragment;
}
