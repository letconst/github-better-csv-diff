# Plan: Support Commit Diff Pages — Completed

## Context

The extension previously only activated on PR pages (`https://github.com/*/pull/*`). This change adds support for commit diff pages (e.g., `https://github.com/{owner}/{repo}/commit/{sha}`). Since GitHub is an SPA, the URL match pattern was widened to `https://github.com/*`.

## Key Finding: Commit Page DOM Structure

Investigated via Playwright. The commit diff page uses the **same Preview UI DOM structure** as PR pages with these differences:

| Feature | PR Preview UI | Commit Page |
|---------|--------------|-------------|
| Container | `div[id^="diff-"][role="region"]` | `div[role="region"]` (no `id^="diff-"`) |
| Empty cell class (Unified) | `empty-diff-line` present | **Not present** — cell text is empty but class is missing |
| Header actions area | `diffHeaderActionWrapper` / `ActionGroup` / `Viewed` button | **None of these** — only "More options" button exists |
| Everything else | Same | Same |

## Changes Made

### Step 1: Widen URL match pattern
**File:** `src/entrypoints/content.ts`
- `matches: ["https://github.com/*/pull/*"]` → `matches: ["https://github.com/*"]`
- Updated JSDoc comment

### Step 2: Fix container selector
**File:** `src/content/observer.ts`
- `div[id^="diff-"][role="region"]` → `div[role="region"]:has(table[role="grid"][aria-label^="Diff for:"])`
- Uses `:has()` with `aria-label` to reliably find diff containers on both PR and commit pages
- Updated module-level comment

### Step 3: Fix Unified layout empty cell detection
**File:** `src/parser/diffParser.ts`
- Added fallback: if `empty-diff-line` class is absent, check `extractLineNumber() === null` instead
- Changed conditions from `oldEmpty` / `newEmpty` to `oldEmpty && !newEmpty` / `newEmpty && !oldEmpty` for safety

### Step 4: Fix toggle button position on commit pages
**File:** `src/content/observer.ts` (`findActionsArea`)
- Added fallback: locate `button[aria-label="More options"]` parent as actions area
- Placed between existing "Viewed" button fallback and Classic UI fallback

### Step 5: Update descriptions
- `package.json`: "in GitHub PRs" → "on GitHub"
- `wxt.config.ts`: "in GitHub PR file reviews" → "on GitHub"
- `CLAUDE.md`: Overview and Architecture sections updated

## Files Modified

1. `src/entrypoints/content.ts` — URL pattern + comment
2. `src/content/observer.ts` — container selector, button placement fallback, comment
3. `src/parser/diffParser.ts` — Unified layout empty cell fallback
4. `package.json` — description
5. `wxt.config.ts` — manifest description
6. `CLAUDE.md` — Overview + Architecture sections

## Verification — Passed

- `npm run build` — success
- PR files page (Split + Unified) — CSV table renders correctly
- Commit diff page (Split) — CSV table renders correctly
- Commit diff page (Unified) — CSV table renders correctly
- Toggle button position — correct on both PR and commit pages
