# Reconstruct quoted records cut by a collapsed region (#55)

## Context

A diff hunk can start or end inside a quoted multiline CSV record: the record's
opening (or closing) quote sits in the collapsed region, so the visible lines
parse as a truncated fragment. #70 made each hunk its own parse segment so the
fragment no longer swallows neighbouring hunks, but the fragment itself is
still shown as its own row(s). This change fetches the file at the side's
revision and shows the complete record instead.

## Decisions

- **Source**: the existing raw endpoint only
  (`${location.origin}/{owner}/{repo}/raw/{ref}/{path}`, which `headerFetcher`
  already uses). No new domain, no new permission.
- **Trigger** (heuristic): a segment is treated as cut when its text holds an
  odd number of `"` characters (an unmatched quote). This catches a hunk whose
  first visible lines include the closing `"` of the record, and a hunk whose
  last visible lines include the opening `"`. A hunk whose visible part of the
  record contains no quote at all is indistinguishable from plain rows and
  stays a fragment; so does a record cut at both ends (even parity).
  Papa's `MissingQuotes` is not used as the signal: an unquoted field with a
  stray `"` (the start-cut case) parses without an error.
- **Fetch**: `src/content/fileFetcher.ts`, `fetchFileText(owner, repo, ref,
  filepath): Promise<string | null>`. One plain GET (no Range) per
  (owner, repo, ref, path), cached as a Promise like `headerFetcher`, null
  results evicted, `clearFileCache()` called from the observer's navigation
  teardown next to `clearHeaderCache()`. A `Content-Length` above 5 MiB aborts
  the request (`console.warn`, null). Non-OK status and network errors warn and
  return null. The header fetch stays separate (a Range request on the same
  URL); a cut diff makes two requests to the same raw URL.
- **Per side, own ref only**: before is reconstructed from `baseRef`, after
  from `headRef`. A side without a ref (Classic UI before) keeps its fragment
  and shows no loading state. Never borrow the other side's content.
- **Validation**: before replacing anything, every numbered line of the cut
  segment must equal the same line (1-based) of the fetched file, both with a
  trailing `\r` stripped. A mismatch (branch drift on compare view, stale ref)
  keeps the fragment and warns once.
- **Reconstruction**: split the fetched text into physical lines, strip a
  trailing `\r` from each (same normalisation as the diff lines), and parse the
  joined text once with the delimiter already chosen for the diff segments
  (Papa `step` with cursor mapping as in `parseSegment`) into records with an
  inclusive physical line span `[startLine, endLine]`. `endLine` is the line
  of the last character of the record itself: the record terminator that
  Papa's cursor has consumed is excluded, and a final record without a
  trailing newline ends on its own last line. The cut segment's rows are
  replaced by the records whose span intersects the segment's physical line
  range (so an end-cut record whose span runs past the segment end is
  included). Each row's line number is `max(record.startLine,
  segment.firstLine)` so alignment and the row matcher keep working on
  hunk-visible line numbers. Rows that were already complete inside the
  segment come out identical. If no record intersects, the fragment rows are
  kept. No visual marker for content that came from the collapsed region.
- **One-sided reconstruction**: when only one side of a hunk is rebuilt (the
  other side has no ref or failed validation), an `unchanged` alignment entry
  can resolve to a row on one side only. Today `buildRowTokens` skips such an
  entry, which leaves a row unconsumed and sends `matchRows` to the key/order
  fallback, losing gap rows. The matcher now emits that entry as a one-sided
  token (`removed` for before-only, `added` for after-only) so the alignment
  result stays complete; the fragment then shows next to the full record
  inside the same hunk.
- **Rendering**: two phases like the header fetch. The initial render shows
  every row of a cut segment on a side that will be fetched as one
  `td[colSpan]` "Loading..." cell (class `csv-diff-loading`, same as the
  header placeholder), so raw fragment text is never shown and then replaced.
  If the row that default mode would promote to the header belongs to such a
  segment (a cut header record), that side's header renders in loading mode
  too. Inline diff is skipped for a row pair where either side is loading, and
  column-width measurement ignores spanning loading cells (measure the first
  non-spanning body row, if any). When all fetches settle, `diffToCsv` is
  recomputed with the fetched texts and the table is re-rendered through the
  existing `fetchAndRerender` path (`setupTableObservers` re-registered). A
  failed or mismatched fetch leaves that segment's fragment rows (no loading
  cell) in the re-render.
- **Fetch gating**: file fetches are decided independently of header fetches.
  `processCsvDiffBlock` computes `willFetchBeforeFile` / `willFetchAfterFile`
  (that side has cut rows and a ref) before the existing early returns, and
  both returns consider header and file flags together. `fetchAndRerender`
  receives the original `diffLines` and rebuilds `csvDiff` from them.
- **Caching across re-renders**: raw/table toggle is a `display` toggle and
  triggers nothing. Expanding a collapsed region rebuilds the region (Preview)
  or the table (Classic); detection runs again on the new hunk boundaries and
  the file comes from the cache, so a newly exposed cut is reconstructed
  without another request.
- **Out of scope**: a record intersecting several hunks (each hunk keeps its
  fragment; nothing is deduplicated), renamed files (the before side gets a
  404 and keeps its fragment), header fetch unification.

## Shape

- `csvParser.ts`: `parseCsvWithLineMap(lines, lineNumbers, fileText?)` returns
  `{ data, lineNumbers, cut: boolean[] }`. `cut[i]` is true when row `i` comes
  from a segment with odd quote parity that was not reconstructed (no
  `fileText`, validation failed, segment has no numbered line, or no record
  intersects). Row membership, not line numbers, carries the cut state so
  null-numbered rows are covered. Every return path (empty input, zero-row
  fallback) returns a `cut` array of matching length; the zero-row fallback
  (joined reparse) runs only when the normal path produced no rows at all.
  A segment's physical range for validation and intersection is its first and
  last non-null line number; a segment with no numbered line is never
  reconstructed.
- `diffParser.ts`: `diffToCsv(lines, files?: { before?: string | null; after?:
  string | null })`; `CsvDiff` gains `beforeCut: boolean[]` / `afterCut:
  boolean[]` parallel to `before` / `after`.
- `rowMatcher.ts`: one-sided `unchanged` entries become one-sided tokens (see
  Decisions).
- `tableRenderer.ts`: `RenderOptions.loading?: { before?: boolean; after?:
  boolean }`; when set for a side, rows with `cut[i]` true render as the
  single loading cell (and the header goes to loading mode if its promoted
  row is cut).
- `observer.ts`: file-fetch flags, `clearFileCache()` on teardown,
  `fetchAndRerender` awaits header and file fetches together and rebuilds
  `csvDiff` from `diffLines` before rendering.
- `e2e/fixtures.ts`: the raw route tells the Range (header) request from the
  full-file request, records which one was made, and lets a test serve or
  hold each independently.

## Tests

- `csvParser.test.ts`: odd quote parity marks a segment's rows as cut (start
  and end cases) and even parity does not; with `fileText`, a start-cut
  segment is replaced by the full record with its line number clamped to the
  segment start; an end-cut segment likewise, including the record running
  past the segment end; a mismatching file keeps the fragment and its cut
  flags; rows already complete in the segment are unchanged; CRLF file text
  yields `\n` inside the rebuilt multiline field; a file without a trailing
  newline reconstructs its last record; a segment with only null line numbers
  is never reconstructed; the delimiter chosen from an intact segment is used
  for the file parse.
- `diffParser.test.ts`: the two `characterization:` tests for #55 and its
  mirror become spec tests (the commit message states the behavioural
  decision): without files the fragment rows are returned with `cut` flags;
  with files the complete record replaces the fragment.
- `rowMatcher.test.ts`: an `unchanged` entry resolving on one side only keeps
  the alignment result (gap rows preserved) with a one-sided row.
- `fileFetcher.test.ts`: raw URL (encoded path, no Range header), one request
  shared by concurrent callers, null evicted so a retry refetches, non-OK,
  network rejection and oversized `Content-Length` return null with a warning,
  `clearFileCache()` forces a refetch.
- `tableRenderer.test.ts`: cut rows on a loading side render one
  `td.csv-diff-loading` spanning all columns while other rows render
  normally; a cut side without `loading` renders the fragment text; a cut
  first row in default mode puts the header in loading mode; no inline diff
  spans next to a loading cell.
- E2E `cut-record.spec.ts` on `classic-pr-split-large-file-cut.html`
  (PR #2 head `944014c7`, hunk 4 at lines 95–98 inside R090): the loading
  cell shows while the full-file response is held and the header response has
  already been served; after release the after side shows R090 with the
  five-line field and the gap rows are still present; the before side (no
  base ref on Classic UI) keeps its fragment rows; a 404 leaves the after
  fragment rows and no loading cell; toggling raw and back makes no further
  raw request.

## Sample data

`example/large-file.csv` on PR #2: R090 is a quoted five-line record on lines
92–96, R092 (line 98) changes, so hunk 4 starts at line 95 inside R090. R033
(lines 33–34) remains the end-cut case at the end of hunk 1.
