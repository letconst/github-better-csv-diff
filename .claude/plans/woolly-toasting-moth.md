# Migrate from @crxjs/vite-plugin to WXT

## Context

The extension is currently built with Vite + `@crxjs/vite-plugin`, which only supports Chrome.
To publish on Firefox as well, we migrate to [WXT](https://wxt.dev/) — a Vite-based framework
that supports Chrome, Firefox, Edge, and Safari from a single codebase.

The extension uses **no browser-specific APIs** (`chrome.*` calls = 0), so the migration is
purely a build-tooling change. All business logic (`parser/`, `renderer/`, `styles/`) stays untouched.

Additionally, version is centralized: WXT reads `version` from `package.json` automatically
and writes it into the generated manifest. No duplication needed.

---

## Steps

### 1. Update `package.json`

- Change `version` from `"1.0.0"` to `"0.1.0"`
- Add devDependency: `wxt`
- Remove devDependencies: `@crxjs/vite-plugin`, `vite`, `@types/chrome`
- Replace scripts:

```json
{
  "dev": "wxt",
  "dev:firefox": "wxt -b firefox",
  "build": "wxt build",
  "build:firefox": "wxt build -b firefox",
  "zip": "wxt zip",
  "zip:firefox": "wxt zip -b firefox",
  "postinstall": "wxt prepare"
}
```

Then run `npm install`.

> **Version management:** WXT automatically reads `version` from `package.json` and
> writes it into the generated `manifest.json`. The `manifest` object in `wxt.config.ts`
> should NOT include a `version` field.

### 2. Create `wxt.config.ts` (replaces `vite.config.ts` + `manifest.json`)

```ts
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "GitHub Better CSV Diff",
    description: "Renders CSV file diffs as side-by-side tables in GitHub PR file reviews",
  },
});
```

- `srcDir: "src"` — WXT looks for `src/entrypoints/`
- `outDir: "dist"` — base output directory (builds go to `dist/chrome-mv3/`, `dist/firefox-mv2/`, etc.)

### 3. Create content script entrypoint

**New file: `src/entrypoints/content.ts`**

```ts
import "../styles/diff-table.css";
import { observeDiffContainers } from "../content/observer";

export default defineContentScript({
  matches: ["https://github.com/*/pull/*"],
  main() {
    console.log("[GitHub Better CSV Diff] Content script loaded");
    observeDiffContainers();
  },
});
```

`defineContentScript` is auto-imported by WXT (no import statement needed).

### 4. Delete replaced files

- `vite.config.ts` — replaced by `wxt.config.ts`
- `manifest.json` — WXT generates this automatically
- `src/content/index.ts` — replaced by `src/entrypoints/content.ts`

`src/content/observer.ts` stays as-is (imported from the new entrypoint).

### 5. Update `tsconfig.json`

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "outDir": "dist"
  }
}
```

WXT's generated tsconfig includes strict mode, ESNext target, and bundler resolution.
The `include` array is also managed by WXT.

### 6. Delete `src/vite-env.d.ts`

WXT auto-generates type references in `.wxt/`. The `vite/client` and `chrome` triple-slash
references are no longer needed.

### 7. Update `.gitignore`

Add:
```
.wxt/
.output/
```

### 8. Update `biome.json`

Add WXT directories to the ignore list:

```json
"includes": ["**", "!!**/dist", "!!**/.wxt", "!!**/.output"]
```

### 9. Update `CLAUDE.md`

- Replace "Vite + CRXJS plugin (Manifest V3)" with "WXT (Manifest V3, Chrome + Firefox)"
- Update build/dev commands to include Firefox variants
- Update "Load `dist/`" instruction to `dist/chrome-mv3/` (Chrome) / `dist/firefox-mv2/` (Firefox)

---

## Files Summary

| File | Action |
|---|---|
| `package.json` | Edit: version, deps, scripts |
| `wxt.config.ts` | Create |
| `src/entrypoints/content.ts` | Create |
| `vite.config.ts` | Delete |
| `manifest.json` | Delete |
| `src/content/index.ts` | Delete |
| `src/vite-env.d.ts` | Delete |
| `tsconfig.json` | Edit |
| `.gitignore` | Edit |
| `biome.json` | Edit |
| `CLAUDE.md` | Edit |

**Untouched (no changes):**
- `src/content/observer.ts`
- `src/parser/csvParser.ts`, `diffParser.ts`, `uiConfig.ts`
- `src/renderer/inlineDiff.ts`, `tableRenderer.ts`
- `src/styles/diff-table.css`
- `.claude/hooks/biome-fix.mjs` (checks file extensions, not framework-specific paths)

---

## Verification

1. `npm install` completes without errors
2. `npm run build` produces `dist/chrome-mv3/` with a valid manifest
3. `npm run build:firefox` produces `dist/firefox-mv2/` (or `firefox-mv3/`)
4. `npm run lint` passes
5. Load `dist/chrome-mv3/` in Chrome (`chrome://extensions`, developer mode) — verify CSV diff table renders on a GitHub PR
6. Load Firefox build in `about:debugging` — verify same behavior
