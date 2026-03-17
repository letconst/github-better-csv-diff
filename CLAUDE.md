# GitHub Better CSV Diff

## Overview

Browser extension (Chrome + Firefox) that renders CSV file diffs as side-by-side tables in GitHub PR "Files changed" tabs.

## Tech Stack

- TypeScript (strict mode)
- WXT framework (Manifest V3, Chrome + Firefox)
- No external UI frameworks

## Architecture

- Content Script injected on `github.com/*/pull/*/files`
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
npm run dev            # Chrome dev (HMR)
npm run dev:firefox    # Firefox dev
npm run build          # Chrome production build
npm run build:firefox  # Firefox production build
```

Load `dist/chrome-mv3/` as an unpacked extension in `chrome://extensions` (developer mode).
For Firefox, load `dist/firefox-mv2/` via `about:debugging`.

## Extension Testing

To verify extension behavior in the browser, use `playwright-cli open --extension` to connect to the user's running browser with the extension installed.

## Key Decisions

- DOM-based diff parsing (not GitHub REST API) to avoid authentication
- Side-by-side (Before / After) table layout
- Match CSV rows by first column (ID/key) when possible; fall back to line-order matching
- Minimal permissions: no host permissions beyond `github.com`
