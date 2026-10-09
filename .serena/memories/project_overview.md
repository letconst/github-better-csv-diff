# GitHub Better CSV Diff - Project Overview

## Purpose
Browser extension (Chrome + Firefox) that renders CSV file diffs as side-by-side tables on GitHub (PR file reviews, commit diffs, compare pages).

## Tech Stack
- TypeScript (strict mode)
- WXT framework (Manifest V3; Firefox build emits MV2)
- No external UI frameworks
- Runtime deps: `papaparse` (CSV), `diff` (inline cell diff)

## Project Structure
```
src/
  entrypoints/     # WXT entry points (content.ts imports the CSS)
  content/         # DOM observer, table injector, route parsing
  parser/          # CSV parser, diff DOM extraction, uiConfig (Preview/Classic UI selectors)
  renderer/        # Table rendering, row matching, inline diff
  styles/          # CSS for diff table
wxt.config.ts      # WXT configuration (manifest + build + console stripping plugin)
biome.json         # Lint + format
```

## Key Architecture Decisions
- DOM-based diff parsing (not GitHub REST API) to avoid authentication
- Side-by-side (Before / After) table layout
- Row matching follows GitHub's diff line order (alignment-based); key/order matching are fallbacks
- Minimal permissions: Chrome declares no host permissions; Firefox build declares `github.com` + `raw.githubusercontent.com` (see CLAUDE.md)
- SPA navigation handled via MutationObserver
- CSS imported in the JS entry point (WXT bundles it as the content script CSS)
