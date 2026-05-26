# Plan: Sticky CSV column header (issue #11)

## Context

When a CSV diff has many rows, scrolling moves the column header out of view, so reviewers
lose track of which column is which. Issue #11 asks for the rendered CSV table's **column
header row** to stay visible (sticky), pinned in the viewport **directly below GitHub's own
sticky file-header bar**, stacking with GitHub's sticky elements — for all UIs/layouts.

The CSS already declares `position: sticky; top: 0` on the header `<th>` (`diff-table.css:26-28`),
but it does nothing. **Root cause (verified live in-browser):** `.csv-diff-side` and
`.csv-diff-container` have `overflow-x: auto` (`diff-table.css:6`, `:17`). Per the CSS overflow
spec, a non-`visible` value on one axis forces the other axis from `visible` to `auto`, so both
become vertical scroll containers. They have no height constraint (`scrollHeight === clientHeight`),
so they never actually scroll vertically — but they **trap** the `th`'s sticky: its nearest
scroll-container ancestor is `.csv-diff-side`, which never scrolls, so the header just scrolls
away with the document.

**Unavoidable constraint:** a header that sticks to the viewport must have no scroll-container
ancestor up to `<html>`; but wide tables need a horizontal scroll container, which (per the same
spec rule) is always also a vertical scroll container. Therefore the header must **not** be a
descendant of the horizontal scroller → header and body must live in separate subtrees (separate
tables) with column widths and horizontal scroll synced manually. This is the standard
**frozen-header** data-grid pattern.

**Verified facts driving the design:**
- A test element placed in `.csv-diff-wrapper` (outside the overflow box) with
  `position: sticky; top: 100px` pinned correctly at viewport y=100 during scroll, exactly below
  GitHub's file header.
- GitHub's sticky file-header differs per UI; the pin offset must be computed at **runtime**:
  - Classic: `.file-header`, `sticky top:60px z:2`, height ≈41 → pins at ≈101px
  - Preview: `div[class*="diffHeaderWrapper"]`, `sticky top:58px z:5`, height ≈42 → pins at ≈100px
  - Identical across unified AND split (our overlay is always side-by-side regardless of GitHub's
    native layout).

**Scope decisions (confirmed with user):**
- Only the **column header row** is sticky. The per-side "Before"/"After" label scrolls away.
- Do **not** remove the Before/After label (possible future change, out of scope here).

## Approach

Restructure each side into a frozen-header layout, sync column widths + horizontal scroll in JS,
and set the sticky `top` from GitHub's file-header geometry at runtime.

New per-side DOM (produced by `buildSide` in `tableRenderer.ts`):

```
div.csv-diff-side                  (overflow: visible — no longer a scroller; min-width: 0)
  div.csv-diff-header              "Before"/"After" label (unchanged; scrolls away)
  div.csv-diff-header-strip        position: sticky; top: var(--csv-diff-sticky-top); overflow: hidden; z-index: 3
    table.csv-diff-header-table    table-layout: fixed
      colgroup (maxCols+1 <col>)   width carrier
      thead > tr                   th.csv-diff-line-num "#" + per-column th
  div.csv-diff-body                overflow-x: auto   (the ONLY scroll container per side)
    table.csv-diff-body-table      table-layout: fixed
      colgroup (maxCols+1 <col>)   width carrier
      tbody                        data rows (td.csv-diff-line-num + data td)
```

## Changes

### 1. `src/renderer/tableRenderer.ts`
- Split `buildSide` (`:191-274`) into `buildHeaderTable(headers, maxCols, isLoading)` and
  `buildBodyTable(matched, side, maxCols)`; assemble the side as label + header-strip + body.
  Add a `<colgroup>` of `maxCols+1` `<col>` to both tables.
  - Loading mode (`:211-217`): the body table still renders its data rows as normal; only the
    header table shows the `colSpan` "Loading…" placeholder (not "header only"). Skip width sync
    while loading; the real column structure comes from the post-fetch re-render.
- New exported `syncColumnWidths(container: HTMLElement): void`, mirroring `syncRowHeights`'s
  clear→read→write pattern, run **per side independently** (Before/After widths need not match;
  only intra-side header↔body must align):
  1. Guard `isConnected` + `getClientRects().length` (like `syncRowHeights:83`).
  2. Clear: set both tables `table-layout: auto`, clear each table's own `style.width` AND all
     `<col>` widths → true natural widths (otherwise a later resync measures against the stale
     fixed px width applied by the previous write pass).
  3. Read: per column, `max(headerCellWidth, firstBodyRowCellWidth)` (clipping avoidance; if no
     body rows, header width only).
  4. Write: `table-layout: fixed`; set identical `col.style.width` on both colgroups; set an
     **explicit JS-computed px total width** (sum of column widths) on BOTH the header and body
     tables (NOT `max-content` — too loose for two separate fixed-layout tables; identical explicit
     totals guarantee matching `scrollLeft` ranges). CSS stays limited to border model +
     `table-layout: fixed`.
  - **Run only post-insertion.** Both sync functions are connectivity-gated (`syncRowHeights:83`),
    and `renderDiffTable` returns a **detached** node (`:117`), so calling them there is a no-op.
    Call from the post-insertion sites in §4 only (initial inject, async rerender, toggle-back).
- **Update `syncRowHeights` (`:82-115`):** change selector `.csv-diff-side table` (`:85`) →
  `.csv-diff-body-table`; keep the `length !== 2` guard. (Header rows are no longer height-paired.)
- Retarget scroll sync (`:173-186`): the scroll container is now `.csv-diff-body`. On its `scroll`
  (keep the `syncing` guard): set the other side's `.csv-diff-body.scrollLeft` AND both sides'
  `.csv-diff-header-strip.scrollLeft` to `this.scrollLeft` (header strip is `overflow:hidden`,
  programmatically scrolled). **Use `scrollLeft` only — do NOT use a `translateX` fallback**: a
  whole-table transform would drag the frozen sticky-left `#` line-num column off too. (If a
  fallback ever proves necessary, it must translate only the non-line-num columns.)
- `highlightChangedCells` (`:276-322`): **no change** (queries `tbody tr`, indexes `children[c+1]`;
  body line-num stays at `children[0]`). Runs before `syncColumnWidths` in `renderDiffTable` —
  correct, since it rewrites cell content that must be measured after.
- `renderDiffTable` runs **only** `highlightChangedCells` (it returns a detached node; the two sync
  functions are connectivity-gated and would no-op). All measurement happens post-insertion in §4,
  ordered `syncColumnWidths` → `syncRowHeights` (widths affect wrapping/heights).

### 2. `src/styles/diff-table.css`
- Remove `overflow-x: auto` from `.csv-diff-container` (`:6`) and `.csv-diff-side` (`:17`); add
  `min-width: 0` to `.csv-diff-side`.
- Remove `position: sticky; top: 0` from `.csv-diff-side th` (`:26-28`); keep its visual styling
  and re-scope to also cover `.csv-diff-header-table th`.
- Replace `.csv-diff-side table { width: 100% }` (`:20-24`): drop the `width` rule — JS sets the
  explicit px total width on both tables (see §1 write pass). CSS keeps only border model
  (`border-collapse: separate; border-spacing: 0`) + `table-layout: fixed` on the two new table
  classes.
- Add:
  ```css
  .csv-diff-header-strip { position: sticky; top: var(--csv-diff-sticky-top, 0px);
    overflow: hidden; z-index: 3; background: var(--bgColor-muted, #f6f8fa); }
  .csv-diff-body { overflow-x: auto; }
  .csv-diff-header-table, .csv-diff-body-table { border-collapse: separate; border-spacing: 0;
    table-layout: fixed; }
  .csv-diff-header-table th { white-space: nowrap; }   /* report full width, don't wrap/under-measure */
  ```
- **z-index strategy** (sticky-top header × sticky-left line-num intersection):
  - Body data `td`: auto. Body sticky-left `.csv-diff-line-num` (`:149-151`): keep `z-index: 1`.
  - `.csv-diff-header-strip`: `z-index: 3` (separate later-DOM sticky subtree → whole header paints
    above all body cells, incl. the sticky-left body line-num column).
  - Replace `th.csv-diff-line-num { z-index: 2 }` (`:154-158`) with the header table's frozen
    top-left corner: `.csv-diff-header-table th.csv-diff-line-num { position: sticky; left: 0; z-index: 2; }`.
  - Backgrounds stay opaque (line-num column already opaque `:144`; header strip bg set above).
- Issue's "subtle bottom border or shadow" cue: keep the existing header `border-bottom` and add a
  subtle `box-shadow` on `.csv-diff-header-strip`.
- Flash-prevention rule (`:122-126`): unaffected.

### 3. `src/parser/uiConfig.ts`
- Add to `UiConfig` (`:6-23`): `stickyFileHeaderSelector: string;`
  - `PREVIEW_UI` (`:25`): `'div[class*="diffHeaderWrapper"]'`
  - `CLASSIC_UI` (`:47`): `'.file-header'` (same node as `headerSelector` here, but keep distinct —
    Preview differs; semantics differ).

### 4. `src/content/observer.ts`
- New `updateStickyTopOffset(container, wrapper, config)`:
  `el = container.querySelector(config.stickyFileHeaderSelector)`;
  `offset = (Number.parseFloat(getComputedStyle(el).top) || 0) + el.getBoundingClientRect().height`
  (**coerce** — `top` resolves to `"auto"` → `NaN` if the selector hits the wrong element);
  `wrapper.style.setProperty("--csv-diff-sticky-top", offset + "px")`. If not found: `0px` +
  `console.warn` (degrades to viewport-top sticky).
- Rerun `updateStickyTopOffset` not only via the file-header ResizeObserver but also on a single
  shared `window` `resize` listener — GitHub's sticky `top` can change at responsive breakpoints
  **without** a header-height change (which a ResizeObserver would miss).
- `injectTableOverlay` (`:466-520`), after `diffBody.prepend(wrapper)` (`:517`):
  `updateStickyTopOffset(...)`; `syncColumnWidths(tableElement)`; `syncRowHeights(tableElement)`;
  register ResizeObservers.
- Toggle-back branch (`:505-510`): also `syncColumnWidths` (before `syncRowHeights`) +
  `updateStickyTopOffset` (measurements read 0 while `display:none`).
- `fetchAndRerender` after `oldContainer.replaceWith(newTable)` (`:334`): disconnect this
  container's old body/header observers, register new ones, then
  `syncColumnWidths(newTable)` + `syncRowHeights(newTable)` + `updateStickyTopOffset`. Keep the
  `wrapper.isConnected` guard (`:320`).
- **Shared visibility guard:** every resync entry point (RO-driven width sync, top-offset, and the
  manual toggle-back) must first check `wrapper.isConnected && wrapper.style.display !== "none"` and
  bail otherwise — measuring a hidden/detached wrapper reads 0. (Not just inside the toggle-back
  path, where the plan previously assumed it.)
- **ResizeObserver registry + teardown:**
  - Module-level `Map<HTMLElement /* container */, PerContainerState>`, **keyed by `container`**
    (persists across collapse/expand; the wrapper does not). `PerContainerState =
    { observers: ResizeObserver[]; rafId: number | null; syncing: boolean; lastWidths: number[][];
    lastTop: number }` — a bare `ResizeObserver[]` is not enough for the feedback-loop mitigation.
  - Per wrapper: one observer per `.csv-diff-body` (re-runs `syncColumnWidths` **then**
    `syncRowHeights` — width changes alter wrapping/heights, so the two sides drift otherwise;
    guarded) + one on the GitHub file-header (re-runs `updateStickyTopOffset`).
  - Mitigate feedback loops using that state: ignore RO callbacks while `syncing`; bail when the
    newly-measured widths/top equal `lastWidths`/`lastTop`; coalesce writes in a single
    `requestAnimationFrame` (store/replace `rafId`).
  - `disconnectObserver` (`:84-95`): for every entry, disconnect all observers **and** `cancelAnimationFrame(rafId)`,
    then clear map (next to existing cache clears).
  - `processExistingDiffs` (`:108-116`): when `PROCESSED_ATTR` set but `.csv-diff-wrapper` gone,
    disconnect+cancel-rAF+remove that container's state (observed bodies are detached → would leak).
    On re-process, always tear down old state for the container before registering new observers.
  - **Restored-DOM recovery (do NOT early-continue blindly):** `disconnectObserver` runs on
    `turbo:before-cache`/`pjax:start` (`:43-45`), clearing the state map; a Turbo snapshot/bfcache
    restore can bring back DOM that still has the wrapper + `PROCESSED_ATTR` **but with all
    JS-attached listeners stripped** (snapshots serialize markup only) — i.e. the Before/After +
    header-strip `scroll` handlers (`tableRenderer.ts:173-184`) and the toggle `click` handler
    (`observer.ts:496-511`) are gone, in addition to the missing observers. The current "wrapper
    present → `continue`" branch (`:110-111`) leaves all of these broken. Fix: if the wrapper exists
    **but the container has no live `PerContainerState`**, do a **full re-init** rather than a
    partial re-bind — remove the stale wrapper (as in the "wrapper gone" path) and fall through to
    `processCsvDiffBlock`, which re-renders + re-injects and thereby re-attaches the scroll/toggle
    listeners and re-registers the observers (+ reruns offset/width/height sync). This is simpler
    and more robust than surgically re-adding observers + listeners onto the restored DOM.

## Feature interactions
- **Multiline cells** (`setTextWithBreaks`/`appendTextWithBreaks`): unchanged; `auto`-layout read
  captures true `<br>` widths; row-height sync runs after.
- **Inline diff highlighting**: unchanged (see §1).
- **Raw Diff toggle / async header re-render**: covered by re-syncs above.
- **Firefox MV2 vs Chrome MV3**: `ResizeObserver`, `getComputedStyle`, `scrollLeft`, CSS custom
  properties all supported; no manifest/permission changes.

## Top risks
1. **`syncRowHeights` selector breakage (certain):** 2 tables → 4. Must retarget to
   `.csv-diff-body-table` or row alignment silently breaks.
2. **ResizeObserver feedback loop:** body observer fires when width-sync writes widths. Guard +
   equality bail + rAF coalescing.
3. **Header/body column drift:** both colgroups need identical per-column + total widths and
   `table-layout: fixed`. Test wide many-column tables.
4. **Measurement while hidden / pre-font-load:** widths read 0 when collapsed/raw. Covered by
   toggle-back re-sync + body ResizeObserver; consider a `document.fonts.ready` trigger.
5. **GitHub markup drift for `div[class*="diffHeaderWrapper"]`:** `0px` fallback keeps it
   functional; log a warning.
6. **Scrollbar gutter mismatch** (body has h-scrollbar, header strip doesn't): cosmetic; if needed
   use `scrollbar-gutter` or pad the strip.

## Verification (manual — no test suite in repo)
Build (`npm run build` / `npm run build:firefox`), load unpacked, then per `CLAUDE.md` use
`playwright-cli attach --extension` against PR #2 (`test/csv-diff-demo`). Confirm in **all four**
combos (classic/unified, classic/split, preview/unified, preview/split):
- Scroll the page so a CSV file diff is cut off at the top → the column header pins directly below
  GitHub's file-header bar (≈100–101px) and stays while body rows scroll under it; un-pins when the
  file scrolls past.
- Horizontal scroll: header columns stay aligned with body columns; Before/After stay locked; the
  sticky-left line-num column and the frozen top-left corner render above body cells.
- Exercise: wide many-column CSV (h-scroll + alignment), multiline cells, modified-row inline
  diffs, collapse/expand cycles (no ResizeObserver leak — spot-check via DevTools), async-fetched
  headers, light + dark themes.
- If no sufficiently wide sample exists, add one to `example/` via the PR #2 test-sample flow in
  `CLAUDE.local.md`.

## Commit breakdown (per CLAUDE.local.md context-boundary policy)
Branch `feature/sticky-csv-header` from `origin/main` after fetch. Suggested order:
1. `feat: add stickyFileHeaderSelector to UiConfig` (uiConfig.ts)
2. `refactor: split CSV table into separate header/body tables` (tableRenderer.ts DOM restructure +
   `syncRowHeights` selector fix, behavior-preserving where possible)
3. `feat: sync CSV column widths + horizontal scroll across header/body` (`syncColumnWidths`, scroll
   retarget)
4. `feat: pin CSV column header below GitHub file header` (CSS sticky/z-index + `updateStickyTopOffset`)
5. `feat: track file-header height + body width via ResizeObserver` (observer wiring + teardown)
Plan file committed **last** (per `CLAUDE.md`).
