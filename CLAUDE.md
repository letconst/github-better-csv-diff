# GitHub Better CSV Diff

## Overview

Chrome extension that renders CSV file diffs as side-by-side tables in GitHub PR "Files changed" tabs.

## Tech Stack

- TypeScript (strict mode)
- Vite + CRXJS plugin (Manifest V3)
- Chrome Extensions API
- No external UI frameworks

## Architecture

- Content Script injected on `github.com/*/pull/*/files`
- Diff data extracted from GitHub DOM (no REST API, no auth required)
- SPA navigation handled via MutationObserver
- Table injected as a toggle overlay above the original diff block

## Project Structure

```
src/
  content/       # Content Script entry, DOM observer, table injector
  parser/        # CSV parser, unified diff parser
  renderer/      # Table rendering logic
  styles/        # CSS for diff table
public/icons/    # Extension icons
manifest.json    # Manifest V3
```

## Conventions

- Functions/variables: camelCase
- Types/interfaces: PascalCase
- CSS classes: kebab-case
- Do not swallow errors silently; use `console.warn` or `console.error`
- Keep each module focused on a single responsibility

## Build & Dev

```bash
npm run dev      # vite build --watch
npm run build    # production build
```

Load `dist/` as an unpacked extension in `chrome://extensions` (developer mode).

## Extension Testing

To verify extension behavior in the browser, use `playwright-cli open --extension` to connect to the user's running browser with the extension installed.

## Key Decisions

- DOM-based diff parsing (not GitHub REST API) to avoid authentication
- Side-by-side (Before / After) table layout
- Match CSV rows by first column (ID/key) when possible; fall back to line-order matching
- Minimal permissions: no host permissions beyond `github.com`
