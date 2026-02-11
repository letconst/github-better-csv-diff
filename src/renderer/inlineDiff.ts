import { diffWordsWithSpace, diffChars, type Change } from "diff";

const inlineDiffThreshold = 0.8;
const charFallbackThreshold = 0.6;

function unchangedRatio(
  changes: Change[],
  before: string,
  after: string
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
  after: string
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

/**
 * Builds DOM nodes for a "before" (deletion) cell with inline diff spans.
 * Removed segments are wrapped in <span class="csv-diff-inline-removed">.
 */
export function renderInlineBefore(changes: Change[]): DocumentFragment {
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
export function renderInlineAfter(changes: Change[]): DocumentFragment {
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
