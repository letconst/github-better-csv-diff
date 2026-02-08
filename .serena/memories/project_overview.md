# GitHub Better CSV Diff - Project Overview

## Purpose
Chrome extension that renders CSV file diffs as side-by-side tables in GitHub PR "Files changed" tabs.

## Tech Stack
- TypeScript (strict mode, ESNext)
- Vite + @crxjs/vite-plugin (Manifest V3)
- Chrome Extensions API
- No external UI frameworks

## Project Structure
```
src/
  content/         # Content Script entry (index.ts), DOM observer (observer.ts)
  parser/          # CSV parser (csvParser.ts), unified diff parser (diffParser.ts)
  renderer/        # Table rendering logic (tableRenderer.ts)
  styles/          # CSS for diff table (diff-table.css)
  vite-env.d.ts    # Vite/Chrome type declarations
manifest.json      # Manifest V3 (source)
vite.config.ts     # Vite configuration with CRXJS plugin
tsconfig.json      # TypeScript config (ESNext, bundler resolution)
```

## Key Architecture Decisions
- DOM-based diff parsing (not GitHub REST API) to avoid authentication
- Side-by-side (Before / After) table layout
- Match CSV rows by first column (ID/key) when possible; fall back to line-order matching
- Minimal permissions: no host permissions beyond `github.com`
- SPA navigation handled via MutationObserver
- CSS imported in JS (not declared in manifest.json) for proper CRXJS bundling
