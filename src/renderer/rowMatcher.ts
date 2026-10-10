/**
 * Pairs before/after CSV rows into display rows (alignment, key, or order).
 */

import type { DiffAlignment } from "../parser/diffParser";

export interface MatchedRow {
  before: string[] | null;
  after: string[] | null;
  type: "added" | "removed" | "modified" | "unchanged";
  beforeLineNumber: number | null;
  afterLineNumber: number | null;
}

function lineNumAt(nums: Array<number | null>, i: number): number | null {
  return nums[i] ?? null;
}

export function matchRows(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
  alignment?: DiffAlignment[],
): MatchedRow[] {
  if (alignment) {
    const result = matchByAlignment(
      alignment,
      before,
      after,
      beforeLineNums,
      afterLineNums,
    );
    if (
      result.consumedBefore === before.length &&
      result.consumedAfter === after.length
    ) {
      return result.rows;
    }
  }
  if (isFirstColumnKey(before, after)) {
    return matchByKey(before, after, beforeLineNums, afterLineNums);
  }
  return matchByOrder(before, after, beforeLineNums, afterLineNums);
}

// --- Alignment-based matching ---

interface RowToken {
  type: "removed" | "added" | "unchanged";
  beforeIndex: number | null;
  afterIndex: number | null;
}

function buildRowTokens(
  alignment: DiffAlignment[],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): RowToken[] {
  const bMap = new Map<number, number>();
  for (let i = 0; i < beforeLineNums.length; i++) {
    const ln = beforeLineNums[i];
    if (ln != null) bMap.set(ln, i);
  }
  const aMap = new Map<number, number>();
  for (let i = 0; i < afterLineNums.length; i++) {
    const ln = afterLineNums[i];
    if (ln != null) aMap.set(ln, i);
  }

  const consumedB = new Set<number>();
  const consumedA = new Set<number>();
  const tokens: RowToken[] = [];

  // Each alignment entry maps a physical diff line to a logical CSV row via
  // line-number lookup. Entries that don't resolve (header rows sliced off by
  // resolveHeaderAndData, or continuation lines of multi-line CSV fields whose
  // start line was already consumed) are silently skipped.
  for (const entry of alignment) {
    if (entry.type === "unchanged") {
      const bi =
        entry.oldLineNumber != null ? bMap.get(entry.oldLineNumber) : undefined;
      const ai =
        entry.newLineNumber != null ? aMap.get(entry.newLineNumber) : undefined;
      if (bi === undefined || ai === undefined) continue;
      if (consumedB.has(bi) || consumedA.has(ai)) continue;
      consumedB.add(bi);
      consumedA.add(ai);
      tokens.push({ type: "unchanged", beforeIndex: bi, afterIndex: ai });
    } else if (entry.type === "removed") {
      const bi =
        entry.oldLineNumber != null ? bMap.get(entry.oldLineNumber) : undefined;
      if (bi === undefined || consumedB.has(bi)) continue;
      consumedB.add(bi);
      tokens.push({ type: "removed", beforeIndex: bi, afterIndex: null });
    } else {
      const ai =
        entry.newLineNumber != null ? aMap.get(entry.newLineNumber) : undefined;
      if (ai === undefined || consumedA.has(ai)) continue;
      consumedA.add(ai);
      tokens.push({ type: "added", beforeIndex: null, afterIndex: ai });
    }
  }

  return tokens;
}

interface PairedToken {
  type: "removed" | "added" | "modified" | "unchanged";
  beforeIndex: number | null;
  afterIndex: number | null;
}

function pairBlocks(
  tokens: RowToken[],
  beforeData: string[][],
  afterData: string[][],
): PairedToken[] {
  const result: PairedToken[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (tokens[i]!.type === "unchanged") {
      result.push(tokens[i]!);
      i++;
      continue;
    }

    // Collect all non-unchanged tokens until the next unchanged (or end).
    // Split layout may interleave removed/added, so we keep the original
    // order for fallback while separating into removed/added for pairing.
    const blockTokens: RowToken[] = [];
    const removedBlock: RowToken[] = [];
    const addedBlock: RowToken[] = [];
    while (i < tokens.length && tokens[i]!.type !== "unchanged") {
      blockTokens.push(tokens[i]!);
      if (tokens[i]!.type === "removed") {
        removedBlock.push(tokens[i]!);
      } else {
        addedBlock.push(tokens[i]!);
      }
      i++;
    }

    if (removedBlock.length === 0) {
      result.push(...addedBlock);
      continue;
    }

    if (addedBlock.length === 0) {
      result.push(...removedBlock);
      continue;
    }

    result.push(
      ...tryPairBlock(
        removedBlock,
        addedBlock,
        blockTokens,
        beforeData,
        afterData,
      ),
    );
  }

  return result;
}

function tryPairBlock(
  removedBlock: RowToken[],
  addedBlock: RowToken[],
  blockTokens: RowToken[],
  beforeData: string[][],
  afterData: string[][],
): PairedToken[] {
  // 1R/1A: always pair as modified (position-based, like GitHub split view).
  // Adjacent removed+added in the diff are the same logical edit regardless
  // of whether the first column changed — moved rows are separated by context.
  if (removedBlock.length === 1 && addedBlock.length === 1) {
    return [
      {
        type: "modified",
        beforeIndex: removedBlock[0]!.beforeIndex,
        afterIndex: addedBlock[0]!.afterIndex,
      },
    ];
  }

  // Larger blocks: try key-based monotonic pairing
  // Check keys are non-empty and unique within each side
  const rKeys = new Map<string, number>();
  for (let j = 0; j < removedBlock.length; j++) {
    const key = beforeData[removedBlock[j]!.beforeIndex!]?.[0] ?? "";
    if (!key || rKeys.has(key)) return [...blockTokens];
    rKeys.set(key, j);
  }
  const aKeys = new Map<string, number>();
  for (let j = 0; j < addedBlock.length; j++) {
    const key = afterData[addedBlock[j]!.afterIndex!]?.[0] ?? "";
    if (!key || aKeys.has(key)) return [...blockTokens];
    aKeys.set(key, j);
  }

  // Match by key and check monotonicity
  const matches: Array<{ rIdx: number; aIdx: number }> = [];
  for (const [key, rIdx] of rKeys) {
    const aIdx = aKeys.get(key);
    if (aIdx !== undefined) {
      matches.push({ rIdx, aIdx });
    }
  }
  matches.sort((a, b) => a.aIdx - b.aIdx);

  // Verify monotonic on removed side
  let lastR = -1;
  for (const m of matches) {
    if (m.rIdx < lastR) return [...blockTokens];
    lastR = m.rIdx;
  }

  // Two-cursor merge: emit in diff order
  const matchedR = new Set(matches.map((m) => m.rIdx));
  const matchedA = new Set(matches.map((m) => m.aIdx));
  const result: PairedToken[] = [];

  let nextR = 0;
  let nextA = 0;
  for (const { rIdx, aIdx } of matches) {
    // Flush unmatched removed before this anchor
    while (nextR < rIdx) {
      if (!matchedR.has(nextR)) {
        result.push(removedBlock[nextR]!);
      }
      nextR++;
    }
    // Flush unmatched added before this anchor
    while (nextA < aIdx) {
      if (!matchedA.has(nextA)) {
        result.push(addedBlock[nextA]!);
      }
      nextA++;
    }
    // Emit modified pair
    result.push({
      type: "modified",
      beforeIndex: removedBlock[rIdx]!.beforeIndex,
      afterIndex: addedBlock[aIdx]!.afterIndex,
    });
    nextR = rIdx + 1;
    nextA = aIdx + 1;
  }

  // Flush remaining
  while (nextR < removedBlock.length) {
    if (!matchedR.has(nextR)) {
      result.push(removedBlock[nextR]!);
    }
    nextR++;
  }
  while (nextA < addedBlock.length) {
    if (!matchedA.has(nextA)) {
      result.push(addedBlock[nextA]!);
    }
    nextA++;
  }

  return result;
}

function matchByAlignment(
  alignment: DiffAlignment[],
  beforeData: string[][],
  afterData: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): { rows: MatchedRow[]; consumedBefore: number; consumedAfter: number } {
  const tokens = buildRowTokens(alignment, beforeLineNums, afterLineNums);
  const paired = pairBlocks(tokens, beforeData, afterData);

  const consumedB = new Set<number>();
  const consumedA = new Set<number>();
  const rows: MatchedRow[] = [];

  for (const p of paired) {
    const bi = p.beforeIndex;
    const ai = p.afterIndex;
    const beforeRow = bi != null ? beforeData[bi]! : null;
    const afterRow = ai != null ? afterData[ai]! : null;

    let type: MatchedRow["type"];
    if (p.type === "removed") {
      type = "removed";
    } else if (p.type === "added") {
      type = "added";
    } else {
      // "modified" or "unchanged" — verify with actual content.
      // Handles: multiline continuation edits (unchanged token, different content)
      // and reorder-only anchors (modified token, identical content).
      type =
        beforeRow && afterRow && arraysEqual(beforeRow, afterRow)
          ? "unchanged"
          : "modified";
    }

    rows.push({
      before: beforeRow,
      after: afterRow,
      type,
      beforeLineNumber: bi != null ? lineNumAt(beforeLineNums, bi) : null,
      afterLineNumber: ai != null ? lineNumAt(afterLineNums, ai) : null,
    });

    if (bi != null) consumedB.add(bi);
    if (ai != null) consumedA.add(ai);
  }

  return {
    rows,
    consumedBefore: consumedB.size,
    consumedAfter: consumedA.size,
  };
}

// --- Key/order-based matching (fallback) ---

function isFirstColumnKey(before: string[][], after: string[][]): boolean {
  if (before.length === 0 && after.length === 0) return false;

  const beforeKeys = before.map((r) => r[0] ?? "");
  const afterKeys = after.map((r) => r[0] ?? "");

  // Check uniqueness
  if (new Set(beforeKeys).size !== beforeKeys.length) return false;
  if (new Set(afterKeys).size !== afterKeys.length) return false;

  // Check overlap
  const beforeSet = new Set(beforeKeys);
  const overlap = afterKeys.filter((k) => beforeSet.has(k)).length;
  const maxLen = Math.max(beforeKeys.length, afterKeys.length);
  return maxLen > 0 && overlap / maxLen >= 0.3;
}

function matchByKey(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): MatchedRow[] {
  const beforeMap = new Map<string, string[]>();
  for (const row of before) beforeMap.set(row[0] ?? "", row);

  const afterIndex = new Map<string, number>();
  for (let i = 0; i < after.length; i++) {
    afterIndex.set(after[i]![0] ?? "", i);
  }

  const result: MatchedRow[] = [];
  let nextAfterFlush = 0;

  for (let bi = 0; bi < before.length; bi++) {
    const beforeRow = before[bi]!;
    const key = beforeRow[0] ?? "";
    const ai = afterIndex.get(key);

    if (ai !== undefined) {
      // Flush after-only rows that precede this matched position
      for (let j = nextAfterFlush; j < ai; j++) {
        const afterKey = after[j]![0] ?? "";
        if (!beforeMap.has(afterKey)) {
          result.push({
            before: null,
            after: after[j]!,
            type: "added",
            beforeLineNumber: null,
            afterLineNumber: lineNumAt(afterLineNums, j),
          });
        }
      }
      nextAfterFlush = Math.max(nextAfterFlush, ai + 1);

      const equal = arraysEqual(beforeRow, after[ai]!);
      result.push({
        before: beforeRow,
        after: after[ai]!,
        type: equal ? "unchanged" : "modified",
        beforeLineNumber: lineNumAt(beforeLineNums, bi),
        afterLineNumber: lineNumAt(afterLineNums, ai),
      });
    } else {
      result.push({
        before: beforeRow,
        after: null,
        type: "removed",
        beforeLineNumber: lineNumAt(beforeLineNums, bi),
        afterLineNumber: null,
      });
    }
  }

  // Flush remaining after-only rows
  for (let j = nextAfterFlush; j < after.length; j++) {
    const afterKey = after[j]![0] ?? "";
    if (!beforeMap.has(afterKey)) {
      result.push({
        before: null,
        after: after[j]!,
        type: "added",
        beforeLineNumber: null,
        afterLineNumber: lineNumAt(afterLineNums, j),
      });
    }
  }

  return result;
}

function matchByOrder(
  before: string[][],
  after: string[][],
  beforeLineNums: Array<number | null>,
  afterLineNums: Array<number | null>,
): MatchedRow[] {
  const result: MatchedRow[] = [];
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = i < before.length ? before[i] : null;
    const a = i < after.length ? after[i] : null;

    if (b && a) {
      const equal = arraysEqual(b, a);
      result.push({
        before: b,
        after: a,
        type: equal ? "unchanged" : "modified",
        beforeLineNumber: lineNumAt(beforeLineNums, i),
        afterLineNumber: lineNumAt(afterLineNums, i),
      });
    } else if (b) {
      result.push({
        before: b,
        after: null,
        type: "removed",
        beforeLineNumber: lineNumAt(beforeLineNums, i),
        afterLineNumber: null,
      });
    } else if (a) {
      result.push({
        before: null,
        after: a,
        type: "added",
        beforeLineNumber: null,
        afterLineNumber: lineNumAt(afterLineNums, i),
      });
    }
  }

  return result;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
