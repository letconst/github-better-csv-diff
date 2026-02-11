# Layout Fix Plan: Button Position & Seamless Table

## Context

The toggle button ("Raw Diff" / "Table View") and CSV diff table have layout issues in both Preview UI and Classic UI:
- **Preview UI**: Button floats below the file header instead of inside it; table has an unnecessary wrapper border/padding
- **Classic UI**: Button stacks above the Viewed button (increasing header height) instead of appearing inline; same wrapper issue

## Root Causes

1. **Preview UI button**: `actionsSelector` (`[class*="diffHeaderActionWrapper"], [class*="ActionGroup"]`) no longer matches any element in GitHub's current DOM (CSS module classes changed). Falls back to `header.appendChild()` which places the button outside the inner header flex container.

2. **Classic UI button**: `actionsSelector: ".file-actions"` matches correctly, but `prepend()` places our button as a block-level element at the top of `.file-actions`, above the inner `<div class="d-flex flex-justify-end">` that holds Viewed/Comment/More inline.

3. **Wrapper**: `csv-diff-wrapper` has `padding: 8px` and `csv-diff-container` has `border`, `border-radius`, `margin` creating a visible "box in a box" inside GitHub's own diff container.

## Changes

### 1. Fix Preview UI button placement (`src/content/observer.ts`)

In `injectTableOverlay`, add fallback logic after `actionsSelector` fails:

```typescript
let actionsArea = header.querySelector<HTMLElement>(config.actionsSelector);

// Fallback: locate actions area via the "Viewed" button (aria-pressed attribute)
if (!actionsArea) {
  const viewedBtn = header.querySelector<HTMLElement>("button[aria-pressed]");
  if (viewedBtn?.parentElement) {
    actionsArea = viewedBtn.parentElement;
  }
}

if (actionsArea) {
  actionsArea.prepend(toggleBtn);
} else {
  header.appendChild(toggleBtn);
}
```

The `button[aria-pressed]` is the "Viewed" toggle in Preview UI. Its parent is `<div class="d-flex flex-items-center gap-2">` — the correct inline actions container.

### 2. Fix Classic UI button placement (`src/parser/uiConfig.ts`)

Change `actionsSelector` to target the inner flex row instead of the outer block container:

```
Before: actionsSelector: ".file-actions"
After:  actionsSelector: ".file-actions > .d-flex"
```

This targets `<div class="d-flex flex-justify-end">` inside `.file-actions`, so `prepend()` places the button inline with Viewed/Comment/More.

### 3. Seamless table (`src/styles/diff-table.css`)

Remove visual wrapper box from `csv-diff-container`:
- Remove `border: 1px solid ...`
- Remove `border-radius: 6px`
- Remove `margin: 8px 0`

Remove padding from `csv-diff-wrapper`:
- Remove `padding: 8px`

### 4. Toggle button CSS refinement (`src/styles/diff-table.css`)

Adjust `.csv-diff-toggle-btn` for inline placement in both UIs:
- Change `margin-left: 8px` to `margin-right: 8px` (button is now prepended, so spacing goes on the right)

### 5. Keep toggle button visible when file is collapsed (`src/content/observer.ts`)

In Preview UI, GitHub rebuilds the header DOM on collapse, removing the toggle button. Since no diff table exists while collapsed, re-processing is skipped and the button is never restored.

- Extract `findActionsArea(header, config)` helper to share actions area detection logic
- Add `ensurePlaceholderToggle(container, config)`: injects a placeholder button into the header when the file is collapsed but was previously processed
- Modify `processExistingDiffs`: stop removing the toggle button eagerly when the wrapper disappears. Instead, only remove it right before re-processing (when the table is available again). When collapsed (no table), call `ensurePlaceholderToggle` to keep the button visible.
- The placeholder is replaced with a fully functional button when the file is re-expanded

## Files to Modify

| File | Change |
|------|--------|
| `src/content/observer.ts` | Add `button[aria-pressed]` fallback, extract `findActionsArea` helper, add `ensurePlaceholderToggle`, keep button visible on collapse |
| `src/parser/uiConfig.ts` | Change Classic UI `actionsSelector` to `.file-actions > .d-flex` |
| `src/styles/diff-table.css` | Remove wrapper padding, container border/radius/margin; adjust toggle button margin |

## Verification

1. `npm run build`
2. Open https://github.com/letconst/github-better-csv-diff/pull/2/changes (Preview UI):
   - Toggle button appears inline with Viewed/Comment/More buttons
   - Table has no extra border/padding wrapper — seamless with file header
   - Toggle, collapse/expand, re-expand flash prevention all still work
   - **Collapse a file → button remains visible in the header**
   - **Re-expand → table is restored and button is fully functional**
3. Switch to Classic UI (`/files`):
   - Toggle button appears inline, to the left of Viewed
   - File header height is unchanged from GitHub default
   - Table is seamless
4. Test both UIs in dark mode (theme CSS variables)
