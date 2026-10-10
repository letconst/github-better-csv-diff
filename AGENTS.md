# GitHub Better CSV Diff

## Overview

Browser extension (Chrome + Firefox) that renders CSV file diffs as side-by-side tables on GitHub (PR file reviews, commit diffs, etc.).

## Tech Stack

- TypeScript (strict mode)
- WXT framework (Manifest V3, Chrome + Firefox)
- No external UI frameworks

## Architecture

- Content Script injected on `github.com/*`
- Diff data extracted from GitHub DOM (no REST API, no auth required)
- SPA navigation handled via MutationObserver
- Table injected as a toggle overlay above the original diff block

## Project Structure

```
src/
  entrypoints/   # WXT entry points (content script)
  content/       # DOM observer, table injector
  parser/        # CSV parser, unified diff parser
  renderer/      # Table rendering logic
  styles/        # CSS for diff table
public/icons/    # Extension icons
e2e/             # Playwright E2E specs (production build + intercepted github.com)
test/fixtures/   # Captured GitHub DOM containers and CSV before/after pairs
scripts/         # Build verification scripts (check-manifest.mjs)
vitest.config.ts # Vitest configuration
playwright.config.ts # Playwright configuration
wxt.config.ts    # WXT configuration (manifest + build)
```

## Conventions

- Functions/variables: camelCase
- Types/interfaces: PascalCase
- CSS classes: kebab-case
- Do not swallow errors silently; use `console.warn` or `console.error`
- Keep each module focused on a single responsibility

## Build & Dev

```bash
pnpm dev            # Chrome dev (HMR)
pnpm dev:firefox    # Firefox dev
pnpm build          # Chrome production build
pnpm build:firefox  # Firefox production build
```

Load `dist/chrome-mv3/` as an unpacked extension in `chrome://extensions` (developer mode).
For Firefox, load `dist/firefox-mv2/` via `about:debugging`.

## Manual Browser Verification

To verify extension behavior in the browser, use `playwright-cli attach --extension` to connect to the user's running browser with the extension installed.

## Testing

- Stack: Vitest + happy-dom. Tests are colocated as `src/**/*.test.ts`; run with `pnpm test`.
- E2E: Playwright loads the production `dist/chrome-mv3` and serves fixture pages at `https://github.com/...` through request interception, so the manifest `matches`, CSS injection and header-fetch URLs run as shipped. Run `pnpm build && pnpm test:e2e`. The extension has no service worker; readiness is the injected toggle button.
- Live DOM check: `e2e-live/` runs the production build against real, logged-out github.com pages (PR #2 and the `example/wide.csv` commit) with no interception, weekly via `.github/workflows/live-dom-check.yml`, which files an issue on failure. Run locally with `pnpm build && pnpm test:e2e:live`. `example/sample.csv` on PR #2 and `example/wide.csv` in the commit must stay in sync with `test/fixtures/csv`.
- Tests assert public contracts only: exported functions and rendered DOM semantics (CSS classes, text). Never test private helpers or export them just for tests. No snapshot tests.
- Derive expectations independently of the implementation, from a reviewable source (AGENTS.md, an issue, a plan file, a PR description). Never generate them by running the code under test.
- Behavior without such a source is pinned with a `characterization:` test name so it is not mistaken for spec.
- New features start from a failing test written from the issue or plan.
- Changing an existing assertion requires a stated behavioral decision in the commit message or PR.
- Adding tests for unchanged existing behavior is an allowed test-only commit.

## Plan Files

- Plan files (`.claude/plans/`) should be committed as the **last commit** on the branch, after all implementation and docs commits.

## Key Decisions

- DOM-based diff parsing (not GitHub REST API) to avoid authentication
- Side-by-side (Before / After) table layout
- Row matching follows GitHub's diff line order (alignment-based); first-column key matching and line-order matching are fallbacks
- Adjacent removed+added lines always pair as one modified row, even when the first-column key differs (#30)
- When one side has fewer columns, its padded cells are styled as removed and the extra cells on the other side as changed
- Minimal permissions: Chrome declares no host permissions (content-script `fetch` inherits page privileges). Firefox content-script `fetch` runs with the extension principal, so cross-origin requests require explicit host permissions — declared **for the Firefox build only** in `wxt.config.ts` (`github.com` + `raw.githubusercontent.com`, the latter being the redirect target of `github.com/.../raw/...`)
