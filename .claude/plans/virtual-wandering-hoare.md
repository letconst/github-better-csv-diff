# Plan: Use file's first row as header when diff starts mid-file (Issue #10)

## Context

When a CSV diff starts in the middle of a file (e.g., line 54), the extension incorrectly uses the first visible diff row as the table header. The actual CSV header (line 1) is not in the diff context. This feature fetches the real header row from GitHub's raw file endpoint.

**Key approach**: `/{owner}/{repo}/raw/{ref}/{filepath}` is a same-origin endpoint that accepts `Range` headers and uses session cookies (works for private repos). No manifest/permission changes needed.

## Files

| File | Change |
|------|--------|
| `src/content/revisionContext.ts` | **NEW** — Page type detection, base/head ref extraction from DOM |
| `src/content/headerFetcher.ts` | **NEW** — CSV first-row fetching with quote-aware retry, Promise-based cache |
| `src/content/observer.ts` | Async header fetch integration, per-side loading/fallback, SPA cache clearing |
| `src/renderer/tableRenderer.ts` | Per-side `SideHeaderMode` (default/external/loading), `RenderOptions` |
| `src/parser/diffParser.ts` | `getFirstLineNumbers()` — detect first line numbers from raw `DiffLine[]` |
| `src/styles/diff-table.css` | `.csv-diff-loading` placeholder style |

## Architecture

### Ref extraction (`revisionContext.ts`)

Extracts base/head refs by page type, cached per pathname:

| Page type | baseRef | headRef |
|---|---|---|
| Preview UI (`/changes`) | `payload.pullRequestsChangesRoute.comparison.fullDiff.baseOid` (also checks `pullRequestsChangesWithRangeRoute` for SPA navigation) | `.headOid` |
| Classic UI (`/files`) | `null` (see Limitations) | `end_commit_oid` from `show_partial_comparison` data-url |
| Standalone commit (`/commit/:sha`) | `payload.commit.parents[0]`, fallback: `{sha}^` from URL | `payload.commit.oid`, fallback: `{sha}` from URL |
| PR commit (`/pull/:id/commits/:sha`, `/pull/:id/changes/:sha`) | Try commit payload → preview PR payload → URL `{sha}^` fallback | Same chain → URL `{sha}` fallback |
| Compare (`/compare/base...head`) | Parsed from URL (same-repo only, cross-fork returns null) | Same |

### Header fetching (`headerFetcher.ts`)

- Fetch `/{owner}/{repo}/raw/{ref}/{encodedFilepath}` with `Range: bytes=0-4096`
- Quote-aware scan for first complete record; retry with doubled range (up to 64KB) if truncated
- Parse errors return `null`; escaped quotes (`""`) handled correctly
- Promise-based cache keyed by `JSON.stringify([owner, repo, ref, filepath])`; null results evicted immediately

### Per-side header modes (`tableRenderer.ts`)

Each side independently uses one of three modes:

| Mode | Header source | Data rows |
|---|---|---|
| `"default"` | `diff[0]` | `diff[1..]` |
| `"external"` | Provided `headers[]` | `diff[0..]` (all rows) |
| `"loading"` | "Loading..." placeholder | `diff[0..]` (all rows) |

### Observer flow (`observer.ts`)

1. Detect mid-file diff via `getFirstLineNumbers(diffLines)` before CSV parsing
2. Get `RevisionContext` before rendering to determine available refs
3. Initial render with per-side modes: `"loading"` if will fetch or waiting for other side's result, `"default"` if line-1 or both sides can't fetch
4. Async `Promise.all()` fetch, then single full re-render with resolved headers
5. Fallback priority: own header → other side's header → `"default"` mode
6. Guards: `wrapper.isConnected`, cache clearing on SPA navigation

### Additional fixes

- `findButtonByTooltipText()`: PR commit pages use `aria-labelledby` (not `aria-label`) for "More options" button; supports multiple space-separated IDs

## Limitations

- **Classic UI base ref**: `base_commit_oid` is parent commit, not merge base. Before side uses after side's header as fallback.
- **Compare view**: Branch name refs may drift; cross-fork refs unsupported.
- **Renamed files**: Single `filepath` used for both sides. Deferred to follow-up.
- **Blank-line alignment**: Pre-existing `skipEmptyLines` issue in `parseCsv()`. Not addressed.
