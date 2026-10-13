# GitHub DOM fixtures

Diff containers captured from github.com as a logged-out visitor, used to pin
the DOM contract that `extractDiffLinesFromDom` depends on. When GitHub changes
its markup, refresh these and review the test expectations separately.

| File | Source | UI / layout | Captured |
|---|---|---|---|
| `preview-commit-split.html` | `/letconst/github-better-csv-diff/commit/2076518958…?diff=split`, `div[role="region"]` for `example/wide.csv` | Preview UI, split | 2026-10-10 |
| `preview-commit-unified.html` | same commit, `?diff=unified` | Preview UI, unified | 2026-10-10 |
| `preview-pr-split.html` | `/letconst/github-better-csv-diff/pull/2/changes?diff=split&new_files_changed=true`, `div[id^="diff-"][role="region"]` for `example/sample.csv` (logged in) | Preview UI, split | 2026-10-11 |
| `preview-pr-unified.html` | same PR, `?diff=unified&new_files_changed=true` | Preview UI, unified | 2026-10-11 |
| `classic-pr-split.html` | `/letconst/github-better-csv-diff/pull/2/files?diff=split`, `div.file.js-file[data-tagsearch-path="example/sample.csv"]` | Classic UI, split | 2026-10-10 |
| `classic-pr-unified.html` | same PR, `?diff=unified` | Classic UI, unified | 2026-10-10 |
| `classic-pr-split-large-file.html` | same PR, `?diff=split`, `div.file.js-file[data-tagsearch-path="example/large-file.csv"]` (diff starts at line 24) | Classic UI, split | 2026-10-10 |
| `preview-pr-split-large-file.html` | `/letconst/github-better-csv-diff/pull/2/changes?diff=split&new_files_changed=true`, `div[id^="diff-"][role="region"]` for `example/large-file.csv` (diff starts at line 24, logged in) | Preview UI, split | 2026-10-13 |
| `classic-pr-split-large-file-expanded.html` | same PR, `?diff=split`, same container as `classic-pr-split-large-file.html`, captured after clicking "Expand Up" until all context was expanded (`tr.blob-expanded` rows for lines 1-23 and 35-46; file had 46 lines) | Classic UI, split | 2026-10-14 |

Both large-file fixtures predate the 2026-10-13 sample-data change on PR #2:
the file now has three hunks, while the fixtures show the earlier single-hunk
state, which the header-fetch tests rely on.

Revisions: PR #2 compares `96e7fb85` (main) to `20765189` (test/csv-diff-demo).
The commit page shows commit `20765189` (parent `20765189^`).

## Refresh

Open the URL in the dedicated-profile Chrome (`pnpm browser:chrome`, see
AGENTS.md) and run this through the `chrome-devtools` MCP server's
`evaluate_script`, with `filePath` pointing at the fixture:

```
() => document.querySelector('<selector>').outerHTML
```

The file is written with a `.json` extension and holds a JSON string; decode
it to raw HTML and rename it to `<name>.html` before committing.
Logged-out PR pages render the Classic UI. The Preview UI PR page needs a
logged-in session and the `new_files_changed=true` query.

Captures taken with the extension active must be cleaned first: clone the
region, remove `.csv-diff-toggle-btn` and `.csv-diff-wrapper`, drop the
`data-csv-diff-processed` / `data-csv-diff-raw` attributes and the table's inline
`display: none`, then serialize the clone.
