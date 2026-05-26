# Fix: After-side row order in reordered CSV diffs

## Context

When CSV rows are reordered, the after (right) side of the diff table displays rows in **before-side order** instead of the actual new file order. Line numbers are correct but visually jumbled. Both Classic UI and Preview UI are affected.

**Root cause:** `matchByKey()` builds `matched[]` by iterating `before[]` in order. `buildSide()` renders both sides using that same order, so the after side inherits the before side's row sequence.

**Decision:** Follow GitHub's native diff layout (diff-order + blank rows) so both sides always have ascending line numbers.

## Expected result for reorder.csv

```
BEFORE                           | AFTER
header(1)                        | header(1)
E001,Tanaka,Engineer...(2) [DEL] | [blank]
E002,Suzuki,Designer...(3) [DEL] | [blank]
E003,Yamamoto,PM...(4)     [DEL] | [blank]
E004,Watanabe...(5)              | E004,Watanabe...(2)
E005,Ito,QA...(6)          [DEL] | [blank]
[blank]                          | E001,Lead Eng...(3) [ADD]
E006,Nakamura...(7)              | E006,Nakamura...(4)
E007,Kobayashi...(8)       [DEL] | [blank]
[blank]                          | E003,Yamamoto...(5) [ADD]
[blank]                          | E002,Suzuki...inactive(6) [ADD]
E008,Sato...(9)                  | E008,Sato...(7)
[blank]                          | E005,QA Lead...(8) [ADD]
[blank]                          | E007,Kobayashi...(9) [ADD]
[blank]                          | E009,Takahashi...(10) [ADD]
```

## Changes

### 1. `src/parser/diffParser.ts` — Add alignment info to CsvDiff

Add `DiffAlignment` type and `alignment` field to `CsvDiff` interface:

```typescript
export interface DiffAlignment {
  type: "removed" | "added" | "unchanged";
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface CsvDiff {
  // ... existing fields ...
  /** Diff-order alignment. One entry per diff text line. */
  alignment: DiffAlignment[];
}
```

Populate in `diffToCsv()` from the input DiffLine[].

### 2. `src/renderer/tableRenderer.ts` — New matching function

#### Step A: `buildRowTokens()` — Normalize raw alignment to logical CSV rows

Convert raw alignment entries (one per diff text line) into row-level tokens (one per parsed CSV row). This correctly handles multiline CSV fields that span multiple diff lines.

```typescript
interface RowToken {
  type: "removed" | "added" | "unchanged";
  beforeIndex: number | null;
  afterIndex: number | null;
}
```

- Build `lineNum → rowIndex` maps from resolved (post-header-slice) `lineNums` arrays
- Skip null line numbers when building maps
- Emit rules (strict type validation):
  - `unchanged` entry → emit only when **both** old and new sides resolve to valid indices
  - `removed` entry → emit only when old side resolves
  - `added` entry → emit only when new side resolves
- Mark consumed indices to avoid duplicates (multiline CSV continuation lines)
- Non-matching entries (header rows, continuations) → skip silently

#### Step B: `pairBlocks()` — Block pairing with split-layout support

**Critical**: In split layout, `extractDiffLinesFromDom` interleaves removed/added tokens for modified lines (both sides on the same DOM row). Block collection must handle this by collecting **all non-unchanged tokens until the next unchanged** and then separating into removed/added arrays, rather than assuming "consecutive removed then consecutive added."

Pairing rules within each block:

- **1R/1A blocks (special case)**: pair as `"modified"` UNLESS both first-column keys are non-empty and differ (moved row → separate removed/added)
- **Larger blocks (2+ removed and/or 2+ added)**: apply key-matching rule:
  - Require non-empty, unique keys within each side of the block
  - Match by first-column key, verify monotonic added indices
  - If valid: emit in **merged diff order** using two-cursor merge (flush unmatched removed/added before each anchor)
  - If invalid: emit all as separate removed/added

#### Step C: `matchByAlignment()` — Build MatchedRow[] from paired tokens

Orchestrates buildRowTokens → pairBlocks → MatchedRow[] conversion.
Returns `{ rows, consumedBefore, consumedAfter }` for validation.

When converting "unchanged" RowTokens, compare actual CSV data with `arraysEqual()` — emit as `"modified"` if content differs (handles multiline continuation-line edits).

#### Step D: Update `matchRows()` and `renderDiffTable()`

`matchRows()` accepts optional `alignment` parameter. If alignment produces rows that consume all before/after data, use it. Otherwise fall back to existing `matchByKey`/`matchByOrder`.

### 3. No changes needed

- `src/content/observer.ts` — CsvDiff already flows through
- `syncRowHeights()` — visual-position pairing remains correct
- `highlightChangedCells()` — matched array indices still correspond to DOM row order

## Implementation notes

### Split layout token interleaving

In Classic/Preview UI split layout, modified lines produce `[removed, added]` pairs per DOM row. For a block like Delta (3 continuation lines) + Epsilon:

**Unified layout alignment**: `DEL DEL DEL DEL ADD ADD ADD` → tokens: `removed removed added added`
**Split layout alignment**: `DEL+ADD DEL+ADD DEL+ADD DEL` → tokens: `removed added added removed`

The `pairBlocks` function handles both by collecting all non-unchanged tokens to the next unchanged boundary, then separating into removed/added arrays.

## Verification (completed)

- Classic UI unified: reorder.csv ✓, multiline.csv ✓, other files ✓
- Classic UI split: reorder.csv ✓, multiline.csv ✓, other files ✓
- Preview UI unified: ✓
- Preview UI split: ✓
