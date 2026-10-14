# Expand collapsed diff regions (#9)

## Context

GitHub shows changed lines plus three lines of context; the rest of the file is
collapsed behind expand buttons at hunk boundaries. The CSV table has no such
control, so users must switch to Raw Diff to see surrounding rows. #9 asks for
equivalent up/down expansion in the table, styled like GitHub's buttons.

## Verified on live github.com (2026-10-13)

Preview UI (PR `/changes`, all commit pages):

- Hunk row: `tr.diff-line-row > td.diff-hunk-cell` holding
  `button[data-direction="up"|"down"|"all"]` with `aria-label` such as
  "Expand file up from line 24", "Expand file down from line 34",
  "Expand file from line 692 to line 709" (`all`, used for short gaps between
  hunks). A trailing hunk row with empty `@@` text and a `down` button marks a
  collapsed file tail. Between two hunks the row holds `down` + `up`, or one
  `all`. A file that starts at line 1 has a hunk row with no buttons.
- The hunk cell's inline style is
  `background-color: var(--bgColor-accent-muted, var(--color-accent-subtle))`.
- Clicking a native button re-renders the whole `div[role="region"]` (new node,
  new table), expanding 20 lines per click. The existing observer treats the new
  region as unprocessed and rebuilds the CSV table; after one click the table
  started at line 3 instead of 24 with no code change. The header fetch for
  diffs not starting at line 1 already handles the new state.
- GitHub does not adjust `scrollY` on expansion (139 before and after); content
  above the anchor grows and the viewed row moves down. Our re-render behaves
  the same (row 24 moved 598px -> 1123px, `scrollY` unchanged).
- Because the region node is replaced, `data-csv-diff-raw` is lost: expanding
  while in Raw Diff view flips the file back to Table View. Pre-existing bug.
- The file header's own "Expand all lines: <path>" button is visible with the
  table (we never hide the header), so no mirror is needed.

Classic UI (logged-out PR `/files`):

- Hunk row: `tr.js-expandable-line > td.blob-num-expandable >
  a.js-expand.directional-expander[aria-label="Expand Up"|"Expand Down"]`
  with `data-url` to `blob_excerpt` and `data-left-range`/`data-right-range`.
  The header holds `button.js-expand-full[aria-label="Expand all"]`.
- Clicking inserts `tr.blob-expanded` rows into the same table node; the hunk
  text updates in place; 20 lines per click. Expanded rows carry
  `data-line-number` and `blob-num-context`, so `extractDiffLinesFromDom`
  already reads them. The observer skips the container (processed, live
  wrapper), so the CSV table does not update today.
- The logged-out isolated browser context has no extension, so the Classic path
  was verified for GitHub's behavior only; the extension's reaction is covered
  by E2E.

## Decisions (grilled 2026-10-13)

- Proxy GitHub's native expanders; do not fetch file content ourselves. GitHub
  owns fetching, the 20-line step, EOF detection and the choice of buttons.
  Self-fetching full files (design B) stays a possible future mode for full
  multiline correctness.
- Gap row on both sides, same height, icon buttons on both sides (either side
  triggers the same native control). Background
  `var(--bgColor-accent-muted, var(--color-accent-subtle))`. Octicons fold-up /
  fold-down / unfold, muted invisible-button style. No `@@` text, no hidden-line
  count (CSV rows are not physical lines).
- On click: disable the buttons of that gap row on both sides, then click the
  native control. No spinner. No scroll compensation (matches GitHub).
- Render a gap row only where GitHub exposes a control. A line-number
  discontinuity without a native control stays an invisible seam.
- Fix the Raw Diff loss on Preview region re-render in the same branch, as its
  own commit.
- Multi-hunk concatenation in `diffToCsv` (an open quote at the end of one hunk
  swallowing the next hunk) is filed as #68 and not touched here. #55 (hunk
  starting inside a quoted record) stays separate too.
- Add a mid-file expandable region to PR #2's `example/large-file.csv`.

## Design

### Parser (`src/parser`)

- `UiConfig` gains `expanderSelector` and `expanderDirection(el)`.
  Preview: `button[data-direction]`, direction from `dataset.direction`.
  Classic: `a.js-expand`, direction from `aria-label` ("Expand Up" -> `up`,
  "Expand Down" -> `down`, anything else -> `all`).
- Classic hunk rows with expanders are `tr.js-expandable-line` whose first cell
  is `blob-num-expandable`, not `blob-num-hunk` (that class only appears on hunk
  rows without controls, e.g. `sample.csv`). They have two cells, so today the
  cell-count check drops them. `extractDiffLinesFromDom` must treat a row as a
  hunk row when `cells[0]` has `hunkClass` **or**
  `row.querySelector(ui.expanderSelector)` is non-null (the selector matches
  the descendant control, not the `tr`), before the cell-count check.
- `DiffLine` gains a `hunk` variant:
  `{ type: "hunk"; expanders: Expander[] }` with
  `Expander = { direction: "up" | "down" | "all"; label: string; element: HTMLElement }`.
  `extractDiffLinesFromDom` emits it for each hunk row that has at least one
  expander (hunk rows without controls are still skipped). `label` is the
  native `aria-label`.
- `DiffAlignment` becomes a union: the existing line entry plus
  `{ type: "hunk"; expanders: Expander[] }`. `diffToCsv` keeps hunk entries out
  of the CSV text but passes them through to `alignment`. `getFirstLineNumbers`
  ignores them. In the same commit, `buildRowTokens` in `rowMatcher.ts` narrows
  on `entry.type === "hunk"` and skips it, so the parser commit typechecks on
  its own; the matcher commit then replaces that skip with gap emission. The
  existing `beforeSide` / `afterSide` filters in `diffParser.dom.test.ts`
  exclude one type each and would keep `hunk` entries; change them to select
  `removed | unchanged` and `added | unchanged` explicitly in the same commit.

### Matcher (`src/renderer/rowMatcher.ts`)

- `RowToken` and `PairedToken` gain a `gap` variant carrying `expanders`;
  `buildRowTokens` emits it for hunk entries, `pairBlocks` passes it through
  untouched and treats it like `unchanged` as a block terminator, and the final
  `MatchedRow` is `{ type: "gap", expanders, before: null, after: null,
  beforeLineNumber: null, afterLineNumber: null }`. A `removed` block before a
  gap therefore never pairs with an `added` block after it.
- The fallback matchers (`matchByKey`, `matchByOrder`) have no alignment and
  therefore render no gap rows. Documented limitation.

### Renderer (`src/renderer/tableRenderer.ts`, `src/styles/diff-table.css`)

- `buildBodyTable` renders a `gap` row as `tr.csv-diff-row-gap > td[colspan=maxCols+1]`
  holding one `button.csv-diff-expand-btn[data-direction]` per expander with
  the native `aria-label` and `title`, and an inline octicon SVG (fold-up /
  fold-down / unfold; same paths GitHub ships). Both sides get the row.
- Click handler: find all `.csv-diff-expand-btn` in the same gap index on both
  sides and set `disabled`; if `expander.element.isConnected`, call
  `element.click()`; otherwise `console.warn` and re-enable (the native DOM has
  changed under us; the next observer pass rebuilds the table anyway).
- `highlightChangedCells` indexes `tbody tr` by `matched[i]`; since gap rows are
  rendered 1:1 with `matched` entries, keep that indexing and `continue` on
  `matched[i].type === "gap"` (do not filter the DOM rows, or every row after a
  gap shifts). `syncColumnWidths` measures the first body row; it must measure
  the first `tbody tr:not(.csv-diff-row-gap)` instead. `syncRowHeights` pairs
  rows by index; gap rows exist at the same index on both sides, so it needs no
  change.

### Observer (`src/content/observer.ts`)

- Classic re-process: `processCsvDiffBlock` counts the native table's
  `rowSelector` matches at extraction time (same pass as
  `extractDiffLinesFromDom`) and hands that count to `setupTableObservers`,
  which stores it in `PerContainerState`. The async header re-render in
  `fetchAndRerender` passes the **same** count through (it renders the same
  `csvDiff`); it must not re-measure, or rows inserted while the fetch was
  pending would be recorded as already rendered and the table would stay stale.
  In `processExistingDiffs`, a processed container with a live state whose
  current count differs drops its wrapper (restoring the original children's
  `display`), tears down the state and falls through to a fresh
  `processCsvDiffBlock`. Row count is sufficient because expansion only ever
  adds rows; a same-count replacement is not a case GitHub produces here.
- Raw choice persistence: a module-level `Map<string, boolean>` keyed by
  `location.pathname + "\n" + filename` records the Raw Diff / Table View
  choice, written by the toggle handler. `injectTableOverlay` resolves
  `raw = container.hasAttribute("data-csv-diff-raw") || map.get(key) === true`
  and, when the map supplied it, sets `data-csv-diff-raw` on the container
  before `PROCESSED_ATTR` (the processed-region CSS hides the native diff unless
  the raw attribute is present). The pathname in the key makes a diff-to-diff
  `pushState` navigation (which `syncObserverWithRoute` handles without a
  disconnect) start clean; the map is also cleared in `disconnectObserver` so it
  does not outlive the page.
- No "Expand all" mirror; no scroll handling.

### Out of scope

- Fetching file content (design B), multi-hunk parse isolation (#68), #55,
  keyboard focus restoration after the region re-render.

## Tests

Expectations derive from this plan and the live DOM notes above.

- Fixtures: capture `preview-pr-split-large-file.html` from PR #2 `/changes`
  (logged in; clean the extension markup as README describes). The existing
  `classic-pr-split-large-file.html` already carries "Expand Up" / "Expand
  Down" anchors. Record both in `test/fixtures/github/README.md`.
- `diffParser.dom.test.ts`: both fixtures yield a leading `hunk` entry with one
  `up` expander ("Expand file up from line 24" / "Expand Up") and a trailing
  `hunk` entry with one `down` expander; the hunk row of `sample.csv` (starts at
  line 1) yields no entry.
- `diffParser.test.ts`: `diffToCsv` passes hunk entries into `alignment` and
  keeps them out of `before`/`after`.
- `rowMatcher.test.ts`: a hunk entry between two unchanged entries yields a
  `gap` row at that index; removed rows before a gap and added rows after it
  are not paired as `modified`.
- `tableRenderer.test.ts`: a `gap` row renders on both sides with one button
  per expander carrying the native label and `data-direction`; clicking a
  button disables both sides' buttons for that gap and calls the native
  element's `click`; a detached native element logs a warning and leaves the
  buttons enabled; a modified row **after** a gap row still gets
  `csv-diff-cell-changed` / `csv-diff-cell-removed` on the right cells.
- E2E (`e2e/`): Classic fixture page where a test-page script answers our
  expander click by inserting `tr.blob-expanded` rows into the native table; the
  CSV table re-renders with the new rows and the first line number moves up.
  Variant: the header `/raw/` response is held, rows are inserted while it is
  pending, then the response is released; the table still ends up with the
  inserted rows. Preview fixture page where the script replaces the region node on click; with
  Raw Diff selected before the click, the rebuilt file is still in Raw Diff,
  the native table is visible (computed `display` not `none`) and the toggle
  reads "Table View". A `pushState` to another diff pathname followed by a file
  with the same path renders in Table View.
- Manual: Firefox smoke check through the `firefox-devtools` MCP server on PR #2
  (`.click()` on React controls is verified in Chrome only).

## Sample data (PR #2)

This follows the test-data flow in the local project instructions and happens
before the feature branch; it is not part of the feature commit list.

1. On `main`: extend `example/large-file.csv` from 46 to 90 physical lines
   (header + 89 rows, continue the `R0nn` ids, same schema). Commit and push.
2. Merge `main` into `test/csv-diff-demo` so the appended rows exist on both
   sides (otherwise they show up as removed).
3. On `test/csv-diff-demo`: keep the existing change at lines 27-31, change one
   value on line 44 and one on line 75. Commit and push; PR #2 updates.
   Expected native layout with 3 lines of context: hunk 1 = lines 24-34, hunk 2
   = 41-47, hunk 3 = 72-78. Gaps: 1-23 leading (`up`), 35-40 between hunks 1
   and 2 (6 lines, `all`), 48-71 between hunks 2 and 3 (24 lines, `down` +
   `up`), 79-90 trailing (`down`).
4. Update the pattern table in the PR #2 description.

The Classic fixture captured at the old state stays valid for the header fetch
tests; README notes the capture predates the sample change.

## Follow-ups from manual verification (2026-10-14)

- Classic expanded rows (`tr.blob-expanded`) carry `blob-code-inner` on the
  `td` itself, not on a child span, so `CLASSIC_UI` content extraction must
  accept the cell as the text element. Fixture
  `classic-pr-split-large-file-expanded.html` pins it.
- Preview region replacement showed the raw diff for up to 300ms before the
  debounced pass re-injected the table. Additions carrying a container id that
  was already processed are now handled synchronously in the
  `MutationObserver` callback (before paint). The general first-render delay
  stays #5.
- A `down` + `up` pair in a mid-file gap stacks vertically (buttons are
  block-level), as in GitHub's hunk row.
- The first gap row sits under the sticky column header once the user scrolls,
  like any other first body row; its button still works there. Expected.

## Simplify pass (2026-10-14)

- The native row count lives as the value of `data-csv-diff-processed`
  instead of being threaded through `setupTableObservers` /
  `injectTableOverlay` / `fetchAndRerender`; the attribute is written once at
  extraction time, so the header re-render cannot re-measure by accident.
- A clicked gap is remembered by the renderer in a `WeakSet` of the gap's
  native controls; a rebuilt table from the same `CsvDiff` renders them
  disabled, so `fetchAndRerender` carries nothing over. GitHub replaces the
  clicked control once the expansion lands (Classic swaps the anchor's row,
  Preview the region), so a fresh extraction never inherits the mark.
- Expand buttons get their handlers at build time via a per-gap button group
  shared by both sides; no `data-gap-index` round trip.

## Commits

Feature branch `feature/expand-collapsed-regions`, cut from `origin/main`
after the sample data above is pushed. Each commit must typecheck and pass
`pnpm test` on its own.

1. parser: hunk entries with expanders, `UiConfig` selectors, Classic
   expandable-row detection, `DiffAlignment` union with the matcher skip,
   fixtures + tests
2. rowMatcher: gap tokens through `buildRowTokens` / `pairBlocks` + tests
3. renderer: gap rows, expand buttons, click proxy, CSS, highlight skip and
   first-data-row measurement + tests
4. observer: rebuild the table when the native Classic table grows + E2E
5. observer: keep the Raw Diff choice across a Preview region re-render + E2E
6. docs: AGENTS.md key decision (expansion proxies GitHub's native controls)
7. plan file (last commit)
