# GitHub DOM fixtures

Diff containers captured from github.com as a logged-out visitor, used to pin
the DOM contract that `extractDiffLinesFromDom` depends on. When GitHub changes
its markup, refresh these and review the test expectations separately.

| File | Source | UI / layout | Captured |
|---|---|---|---|
| `preview-commit-split.html` | `/letconst/github-better-csv-diff/commit/2076518958…?diff=split`, `div[role="region"]` for `example/wide.csv` | Preview UI, split | 2026-10-10 |
| `preview-commit-unified.html` | same commit, `?diff=unified` | Preview UI, unified | 2026-10-10 |
| `classic-pr-split.html` | `/letconst/github-better-csv-diff/pull/2/files?diff=split`, `div.file.js-file[data-tagsearch-path="example/sample.csv"]` | Classic UI, split | 2026-10-10 |
| `classic-pr-unified.html` | same PR, `?diff=unified` | Classic UI, unified | 2026-10-10 |
| `classic-pr-split-large-file.html` | same PR, `?diff=split`, `div.file.js-file[data-tagsearch-path="example/large-file.csv"]` (diff starts at line 24) | Classic UI, split | 2026-10-10 |

Revisions: PR #2 compares `96e7fb85` (main) to `20765189` (test/csv-diff-demo).
The commit page shows commit `20765189` (parent `20765189^`).

## Refresh

```
playwright-cli open <url>
playwright-cli eval --raw --filename=test/fixtures/github/<name>.html "() => document.querySelector('<selector>').outerHTML"
```

The saved result is a JSON string; decode it to raw HTML before committing.
Logged-out PR pages always render the Classic UI, so Preview UI fixtures come
from a commit page.
