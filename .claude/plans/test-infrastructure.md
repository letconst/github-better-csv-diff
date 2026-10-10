# Test infrastructure

## Context

The extension had no tests. The maintainer wants three things: existing logic
covered, UI tests where feasible, and a discipline that prevents "write the
implementation to make the test pass" — tests must guarantee the intended
behavior, not freeze the current implementation.

## Module map

| Layer | Functions | Environment |
|---|---|---|
| Pure | `parseDiffRoute`, `diffToCsv`, `getFirstLineNumbers`, `parseCsvWithLineMap`, `computeInlineDiff`, `matchRows` | Node |
| Output DOM (structure) | `renderDiffTable`, `renderInlineBefore/After`, `appendTextWithBreaks` | happy-dom |
| Output DOM (geometry) | `syncRowHeights`, `syncColumnWidths` | real browser only |
| Input DOM (GitHub) | `extractDiffLinesFromDom` with `PREVIEW_UI` / `CLASSIC_UI` | happy-dom + captured GitHub HTML |
| Page context | `getRevisionContext`, `fetchCsvHeaderRow` | happy-dom with `setURL`, stubbed `fetch` |
| Browser integration | `observer.ts` lifecycle, toggle/overlay injection, sticky offset | E2E only |

## Stack

- Vitest + happy-dom. Plain Vitest: the extension uses no `browser.*` APIs and no
  WXT path aliases, so `wxt/testing` adds nothing. Tests are colocated as
  `src/**/*.test.ts`; DOM files opt in with `// @vitest-environment happy-dom`.
- GitHub DOM fixtures under `test/fixtures/github/` with a README recording
  capture URL, date, layout and refresh steps. Logged-out PR pages always render
  the Classic UI, so Preview UI fixtures come from a commit page.
- CSV before/after pairs under `test/fixtures/csv/`, added only when a test
  reads them. Expected cell contents come from these files, never from parser
  output.
- CI: `test.yml` runs lint, typecheck, `vitest run`, both browser builds and a
  generated-manifest check. `pull_request` has no branch filter so stacked PRs
  targeting a sibling branch still get checks.

## Guardrails (also in AGENTS.md)

- Test public contracts only: exported functions and the rendered DOM's semantic
  surface. Never export private helpers for tests. No HTML snapshots.
- Expectations are derived by hand and cite a reviewable source: AGENTS.md, an
  issue, this plan, or a PR description that decided the behavior. Behavior
  without such a source is a `characterization:` test.
- Changing an existing assertion requires a stated behavioral decision.
- New features start from a failing test written from the issue or plan.
- Adding coverage for unchanged existing behavior is an allowed test-only
  commit.

## Decisions recorded while writing tests

- An unterminated quote in CSV is warned about and the partial parse is still
  rendered. This is spec.
- A hunk starting inside a quoted multiline record cannot be reconstructed; the
  current best-effort rendering is a characterization test until #55 adds a
  range fetch for the preceding content.
- Adjacent removed+added rows pair as one modified row even when the key
  differs (#30). PR #2's pattern table describes the data change, not the
  presentation.
- Classic split and unified layouts order a change block differently; the
  extractor is asserted per layout and both must reconstruct the same files.
- Marks on padded cells after a column addition are characterization.
- Live commit pages embed the commit under `payload.commitRoute.commit`; the
  extractor now reads `payload.commitRoute.commit` (the shape observed on both
  logged-in and logged-out pages) and no longer reads `payload.commit`, which
  was never observed.

## Refactoring

Only one extraction was justified: the `matchRows` family moved verbatim from
`tableRenderer.ts` to `rowMatcher.ts` after the renderer tests existed. Other
candidates (parameterizing `revisionContext`, splitting `headerFetcher`, moving
filename resolution into `uiConfig`) were dropped: happy-dom and a stubbed
`fetch` cover them through their public functions.

## Stacked PRs

1. #56 Vitest setup, pure-logic tests, CI workflow, testing policy
2. #57 renderer and DOM-extraction tests with GitHub fixtures
3. #59 `rowMatcher.ts` extraction with matcher tests
4. #60 revisionContext and headerFetcher tests; commit-payload fix
5. Playwright E2E: setup, injection, toggle, SPA navigation, header fetch

## Playwright E2E

The production `dist/chrome-mv3` is loaded with `chromium.launchPersistentContext`
(`channel: "chromium"`); one `context.route` handler fulfills `https://github.com/**`
from fixture pages built around the captured containers, serves `/raw/` responses
from a per-test map, and aborts everything else, so `location.origin`, the manifest
`matches`, CSS injection and header-fetch URLs all run as shipped. The extension
has no service worker; readiness is the injected toggle button. Raw responses can
be held behind a promise so navigation-during-fetch is deterministic.

Covered in layer 5: injection on Classic and Preview pages with a computed-style
check, non-CSV containers untouched, toggle, `pushState`-only navigation (URL
polling), Turbo navigation in both directions, same-path body replacement,
delayed insertion, header fetch success / 404 fallback / navigation during a
pending fetch.

Remaining for a later layer: collapsed-file placeholder and re-expand, snapshot
restore, paired row heights, header/body column alignment, synchronized
horizontal scroll, sticky offset after scroll, resize.
Firefox is excluded (Playwright cannot load extensions there); the attached
browser workflow in AGENTS.md remains the manual smoke check. Live github.com
is never a merge gate.
