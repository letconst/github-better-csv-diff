# Suggested Commands

## Build & Dev
- `pnpm dev` / `pnpm dev:firefox` - WXT dev mode (hot reload)
- `pnpm build` / `pnpm build:firefox` - Production build to `dist/chrome-mv3/` or `dist/firefox-mv2/`
- `pnpm lint` / `pnpm lint:fix` - Biome
- `pnpm typecheck` - `tsc --noEmit`

## Loading the Extension
- Chrome: load `dist/chrome-mv3/` as an unpacked extension in `chrome://extensions` (developer mode)
- Firefox: load `dist/firefox-mv2/` via `about:debugging`

## System (Windows)
- `rm` / `mkdir -p` - Works in git bash (the shell environment)
- `git` - Standard git commands
