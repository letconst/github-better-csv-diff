# Plan: Gate MutationObserver startup to diff-related routes (Issue #20)

## Context

With `matches: ["https://github.com/*"]` (added in PR #19 for commit diff support), the content script initializes a MutationObserver on `document.body` + Turbo/PJAX listeners on **every** GitHub page, including Issues, Settings, repo root, etc. This causes unnecessary DOM scanning overhead. The fix gates observer startup to diff-related routes while keeping the broad match pattern for SPA navigation.

## Files to Modify

| File | Action |
|------|--------|
| `src/content/routes.ts` | **New** — `isDiffRoute()` utility |
| `src/content/observer.ts` | **Refactor** — connect/disconnect lifecycle with Turbo teardown |
| `src/entrypoints/content.ts` | **Update** — use new `initObserverLifecycle()` |

## Implementation

### Step 1: Create `src/content/routes.ts`

```ts
const DIFF_ROUTE_PATTERNS: RegExp[] = [
  // PR diff (Classic UI): /:owner/:repo/pull/:num/files
  /^\/[^/]+\/[^/]+\/pull\/\d+\/files\/?$/i,
  // PR diff (Preview UI): /:owner/:repo/pull/:num/changes
  /^\/[^/]+\/[^/]+\/pull\/\d+\/changes\/?$/i,
  // PR commit (Preview UI): /:owner/:repo/pull/:num/changes/:sha
  /^\/[^/]+\/[^/]+\/pull\/\d+\/changes\/[0-9a-f]{7,40}\/?$/i,
  // PR commit (Classic UI): /:owner/:repo/pull/:num/commits/:sha
  /^\/[^/]+\/[^/]+\/pull\/\d+\/commits\/[0-9a-f]{7,40}\/?$/i,
  // Commit diff: /:owner/:repo/commit/:sha
  /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,40}\/?$/i,
  // Compare: /:owner/:repo/compare/:spec (broad — GitHub compare subpaths are limited)
  /^\/[^/]+\/[^/]+\/compare\/.+$/i,
];

export function isDiffRoute(pathname: string = location.pathname): boolean {
  return DIFF_ROUTE_PATTERNS.some((re) => re.test(pathname));
}
```

Each route is explicit with end-of-string anchors (`$`) and optional trailing slash. Case-insensitive (`i` flag) for SHA matching.

Supported routes:
- PR diff (Classic UI): `/:owner/:repo/pull/:num/files`
- PR diff (Preview UI): `/:owner/:repo/pull/:num/changes`
- PR commit (Preview UI): `/:owner/:repo/pull/:num/changes/:sha`
- PR commit (Classic UI): `/:owner/:repo/pull/:num/commits/:sha`
- Commit diff: `/:owner/:repo/commit/:sha`
- Compare view: `/:owner/:repo/compare/:spec`

**Not included**: `/pull/:num` (conversation tab) — shares base path with non-diff content, and the observer overhead on that page is not justified. If inline diff support on conversation tabs is needed later, add it after verifying the DOM structure.

### Step 2: Refactor `src/content/observer.ts`

Replace `observeDiffContainers()` with `initObserverLifecycle()` + connect/disconnect:

```ts
import { isDiffRoute } from "./routes";

type CancellableCallback = MutationCallback & { cancel: () => void };

let observer: MutationObserver | null = null;
let debouncedCallback: CancellableCallback | null = null;
// biome-ignore lint/correctness/noUnusedVariables: retained for future teardown
let urlPollTimer: ReturnType<typeof setInterval> | null = null;
let lifecycleInitialized = false;

export function initObserverLifecycle(): void {
  if (lifecycleInitialized) return;
  lifecycleInitialized = true;

  // Teardown BEFORE Turbo/PJAX swaps the page body
  document.addEventListener("turbo:before-render", disconnectObserver);
  document.addEventListener("turbo:before-cache", disconnectObserver);
  document.addEventListener("pjax:start", disconnectObserver);

  // Re-check route AFTER navigation completes
  document.addEventListener("turbo:load", syncObserverWithRoute);
  document.addEventListener("pjax:end", syncObserverWithRoute);
  window.addEventListener("popstate", syncObserverWithRoute);

  // Poll for URL changes that bypass Turbo/PJAX events (e.g. GitHub PR tab
  // switches via pushState in the main world, invisible to content script's
  // isolated world). Safe if DOM isn't ready: processExistingDiffs is idempotent,
  // and the MutationObserver will catch later inserts.
  urlPollTimer = watchUrlChanges(syncObserverWithRoute);

  // Initial route check
  syncObserverWithRoute();
}

function syncObserverWithRoute(): void {
  if (!isDiffRoute()) {
    disconnectObserver();
    return;
  }
  // Scan BEFORE connecting observer to avoid self-triggered debounced pass
  // (processExistingDiffs mutates DOM via wrapper/button injection)
  processExistingDiffs();
  connectObserver();
}

function connectObserver(): void {
  if (observer || !document.body) return;
  debouncedCallback = debounce(processExistingDiffs, 300);
  observer = new MutationObserver(debouncedCallback);
  observer.observe(document.body, { childList: true, subtree: true });
  console.debug("[GitHub Better CSV Diff] Observer connected", location.pathname);
}

function disconnectObserver(): void {
  // Cancel pending debounce even if observer is already null (fully idempotent)
  debouncedCallback?.cancel();
  debouncedCallback = null;
  if (!observer) return;
  observer.disconnect();
  observer = null;
  console.debug("[GitHub Better CSV Diff] Observer disconnected");
}
```

The `debounce()` helper needs to be updated to return a cancellable callback:

```ts
function debounce(fn: () => void, delayMs: number): CancellableCallback {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const callback = (() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  }) as CancellableCallback;

  callback.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return callback;
}
```

URL polling for SPA navigations invisible to the content script's isolated world:

```ts
function watchUrlChanges(
  onNavigate: () => void,
): ReturnType<typeof setInterval> {
  let lastPathname = location.pathname;
  return setInterval(() => {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      onNavigate();
    }
  }, 500);
}
```

Key design decisions:
- **Early teardown**: `turbo:before-render`, `turbo:before-cache`, and `pjax:start` disconnect the observer *before* Turbo/PJAX swaps the page body, avoiding stale references and pending debounced callbacks
- **Debounce cancellation**: `disconnectObserver()` cancels any pending debounced timer to prevent `processExistingDiffs()` from firing after page swap
- **Observer re-creation**: `connectObserver()` creates a fresh MutationObserver each time (null on disconnect). This avoids issues with stale `document.body` references after Turbo swaps
- **Idempotent initialization**: `lifecycleInitialized` flag prevents double listener registration if entrypoint is invoked twice
- **`syncObserverWithRoute()` always calls `processExistingDiffs()`** on diff routes → handles SPA navigation between diff pages
- `processExistingDiffs()` is idempotent (skips containers with `PROCESSED_ATTR`)
- **URL polling (500ms)**: Content scripts run in an isolated world, so monkey-patching `history.pushState` doesn't intercept main-world calls (e.g. GitHub PR tab switches). Polling `location.pathname` at 500ms is a reliable fallback. Timer handle retained for future teardown.
- **`popstate` listener**: Cheap supplemental signal for back/forward navigation
- All other functions (`processExistingDiffs`, `processCsvDiffBlock`, `injectTableOverlay`, etc.) **remain unchanged**

### Step 3: Update `src/entrypoints/content.ts`

```ts
import { initObserverLifecycle } from "../content/observer";

export default defineContentScript({
  matches: ["https://github.com/*"],
  main() {
    console.log("[GitHub Better CSV Diff] Content script loaded");
    initObserverLifecycle();
  },
});
```

## Edge Cases

| Case | Handling |
|------|----------|
| Navigation between two diff pages | `turbo:before-render` disconnects → `turbo:load` reconnects with fresh observer + re-scan |
| `turbo:load` on initial page load | Safe — `connectObserver()` guards against double-creation (`if (observer) return`) |
| Turbo back/forward (restoration visit) | `turbo:load` fires on restoration → `syncObserverWithRoute()` handles it |
| `?w=1` query changes | Same pathname → observer stays connected; `processExistingDiffs()` re-scans (idempotent) |
| `#diff-*` hash navigation | No event fires, observer stays connected — correct behavior |
| Content script re-injection (MV3) | Module-level state resets → `initObserverLifecycle()` starts fresh |
| SPA navigation via pushState (main world) | Content script's isolated world can't intercept → URL polling (500ms) catches pathname changes |

## Commit Plan

1. `feat: add isDiffRoute() route detection utility` — new `src/content/routes.ts`
2. `refactor: gate observer with connect/disconnect lifecycle` — refactor `observer.ts` + update `content.ts` (includes URL polling fallback and popstate listener)
3. `chore: add plan file for route-gated observer` — this plan file (last commit per convention)

## Verification

1. `npm run build` — confirm no type/build errors
2. Load extension in browser via `playwright-cli`, navigate to:
   - **PR files tab** → observer connects, CSV diffs render
   - **Commit diff page** → observer connects, CSV diffs render
   - **Compare page** → observer connects (if CSV diffs present)
   - **Repo root / Issues / Settings** → observer does NOT connect (check console logs)
   - **PR conversation tab** (`/:owner/:repo/pull/:num`) → observer does NOT connect (intentional exclusion)
   - **SPA navigate**: Issues → PR files → observer connects; PR files → Issues → observer disconnects
   - **Back/forward**: navigate away from diff page and back → observer reconnects
3. Check browser console for connect/disconnect behavior (enable **Verbose** level in DevTools Console filter to see `console.debug` messages; no errors, no stale observers)
