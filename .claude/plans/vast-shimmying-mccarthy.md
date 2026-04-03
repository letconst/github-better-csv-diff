# Classic UI Support (Unified + Split Layouts)

## Context

The extension currently only works on GitHub's Preview UI (`/changes` URL). The Classic UI (`/files` URL) uses a completely different DOM structure. This change adds Classic UI support for both unified and split layouts, covering all 4 combinations (Preview/Classic × Unified/Split).

## DOM Structure Comparison

| Feature | Preview UI | Classic UI |
|---------|-----------|------------|
| URL | `/pull/*/changes*` | `/pull/*/files*` |
| Container | `div[id^="diff-"][role="region"]` | `div.file.js-file[data-tagsearch-path]` |
| Filename | `h3.textContent` (strip Unicode) | `container.dataset.tagsearchPath` |
| Table | `table[role="grid"]` | `table.diff-table` |
| Rows | `tr.diff-line-row` | `tbody tr` |
| Hunk class | `diff-hunk-cell` | `blob-num-hunk` |
| Context class | `diff-line-number-neutral` | `blob-num-context` |
| Empty cell class | `empty-diff-line` | `empty-cell` |
| Content extraction | `cell.textContent` + `stripPrefix()` | `cell.querySelector('.blob-code-inner').textContent` (no prefix) |
| Header | `container.children[0]` | `container.querySelector('.file-header')` |
| Body | `container.children[1]` | `container.querySelector('.js-file-content')` |
| Toggle btn area | `[class*="diffHeaderActionWrapper"], [class*="ActionGroup"]` | `.file-actions` |
| Cell count | 3=unified, 4=split (same) | 3=unified, 4=split (same) |

## Approach: Lightweight UI Config

Define a `UiConfig` type with UI-specific selectors and extraction functions. Pass it to `extractDiffLinesFromDom`. This avoids duplication of the core parsing logic (unified/split detection, row iteration) while keeping UI-specific details isolated.

No new directories or adapter pattern — just a single new file with two config objects.

## Implementation Steps

### 1. Create `src/parser/uiConfig.ts` (new file)

```typescript
export interface UiConfig {
  tableSelector: string;
  rowSelector: string;
  hunkClass: string;       // on cells[0]
  contextClass: string;    // on cells[0]
  emptyClass: string;      // on empty line-number cells
  extractContent(cell: HTMLTableCellElement): string;
}

export const PREVIEW_UI: UiConfig = {
  tableSelector: 'table[role="grid"]',
  rowSelector: "tr.diff-line-row",
  hunkClass: "diff-hunk-cell",
  contextClass: "diff-line-number-neutral",
  emptyClass: "empty-diff-line",
  extractContent: (cell) => cell.textContent ?? "",
};

export const CLASSIC_UI: UiConfig = {
  tableSelector: "table.diff-table",
  rowSelector: "tbody tr",
  hunkClass: "blob-num-hunk",
  contextClass: "blob-num-context",
  emptyClass: "empty-cell",
  extractContent: (cell) =>
    cell.querySelector<HTMLElement>(".blob-code-inner")?.textContent ?? "",
};
```

### 2. Modify `src/parser/diffParser.ts`

- Add `uiConfig: UiConfig` parameter to `extractDiffLinesFromDom(container, uiConfig)`
- Replace hardcoded selectors/class names with `uiConfig.*`
- For content extraction: use `uiConfig.extractContent(cell)` instead of `cell.textContent`
- Remove `stripPrefix()` calls from within the function — Preview UI's `extractContent` returns text with prefix (same as current), Classic UI's returns text without prefix
- Actually: `stripPrefix` is still needed for Preview UI. Move it into `PREVIEW_UI.extractContent`:
  - Preview context: `cell.textContent` (no prefix to strip)
  - Preview added/removed: `stripPrefix(cell.textContent)`
  - Classic all: `cell.querySelector('.blob-code-inner').textContent` (never has prefix)
- Approach: add a `extractChangedContent(cell)` to UiConfig that strips prefix (for preview) or just extracts (for classic). Keep `extractContent` for unchanged lines.

Simpler approach: just one `extractContent` in UiConfig, and `stripPrefix` stays as-is in the parsing loop for preview. The `extractContent` for Classic UI returns content without prefix naturally. For Preview UI, `extractContent` returns `cell.textContent` which has the prefix. So `stripPrefix` is applied the same way as before — it just no-ops when there's no prefix.

**Final approach**: Keep `stripPrefix` in the loop as-is. `UiConfig.extractContent` just gets the raw text from the cell. For Preview UI this includes the prefix; for Classic UI it doesn't. `stripPrefix` is safe on both (no-ops if no prefix).

### 3. Modify `src/content/observer.ts`

#### a. Detect UI type per container

```typescript
type UiType = "preview" | "classic";

function detectUiType(container: HTMLElement): UiType {
  return container.hasAttribute("data-tagsearch-path") ? "classic" : "preview";
}
```

#### b. Refactor `processExistingDiffs()`

Find containers for both UIs:
```typescript
function processExistingDiffs(): void {
  // Preview UI containers
  const previewContainers = document.querySelectorAll<HTMLElement>(
    'div[id^="diff-"][role="region"]'
  );
  // Classic UI containers
  const classicContainers = document.querySelectorAll<HTMLElement>(
    "div.file.js-file[data-tagsearch-path]"
  );

  for (const container of [...previewContainers, ...classicContainers]) {
    if (container.hasAttribute(PROCESSED_ATTR)) continue;
    const uiType = detectUiType(container);
    const config = uiType === "classic" ? CLASSIC_UI : PREVIEW_UI;

    const filename = uiType === "classic"
      ? container.dataset.tagsearchPath ?? null
      : getFilename(container);  // existing h3-based extraction
    if (!filename) continue;

    const isCsv = CSV_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
    if (!isCsv) continue;

    const table = container.querySelector(config.tableSelector);
    if (!table) continue;

    processCsvDiffBlock(container, config);
  }
}
```

#### c. Update `processCsvDiffBlock` to accept `UiConfig`

Pass `config` through to `extractDiffLinesFromDom(container, config)`.

#### d. Update `injectTableOverlay` for Classic UI

Add `uiType` parameter or detect from container:
```typescript
function injectTableOverlay(container: HTMLElement, tableElement: HTMLElement): boolean {
  const isClassic = container.classList.contains("js-file");

  let header: HTMLElement | null;
  let diffBody: HTMLElement | null;

  if (isClassic) {
    header = container.querySelector<HTMLElement>(".file-header");
    diffBody = container.querySelector<HTMLElement>(".js-file-content");
  } else {
    header = container.children[0] as HTMLElement | undefined ?? null;
    diffBody = container.children[1] as HTMLElement | undefined ?? null;
  }

  // ... wrapper and toggle button creation (same as now) ...

  // Toggle button placement
  if (isClassic) {
    const actionsArea = header?.querySelector<HTMLElement>(".file-actions");
    if (actionsArea) actionsArea.prepend(toggleBtn);
    else header?.appendChild(toggleBtn);
  } else {
    const actionsArea = header?.querySelector('[class*="diffHeaderActionWrapper"], [class*="ActionGroup"]');
    if (actionsArea) actionsArea.prepend(toggleBtn);
    else header?.appendChild(toggleBtn);
  }

  container.insertBefore(wrapper, diffBody);
  diffBody!.style.display = "none";
  return true;
}
```

### 4. Modify `manifest.json`

Add `/files*` URL pattern:
```json
"matches": [
  "https://github.com/*/pull/*/changes*",
  "https://github.com/*/pull/*/files*"
]
```

## Files to Modify

| File | Change |
|------|--------|
| `src/parser/uiConfig.ts` | **New** — UiConfig interface + PREVIEW_UI / CLASSIC_UI constants |
| `src/parser/diffParser.ts` | Add `uiConfig` param to `extractDiffLinesFromDom`, use config selectors |
| `src/content/observer.ts` | Detect UI type, find both container types, branch injectTableOverlay |
| `manifest.json` | Add `/files*` match pattern |

## Verification

Manual test on https://github.com/letconst/github-better-csv-diff/pull/2/files:

1. **Classic Unified**: Load `/files` (default) → CSV tables render with toggle
2. **Classic Split**: Switch to Split view (`?diff=split`) → tables render correctly
3. **Preview Unified**: Load `/changes` → existing behavior unchanged
4. **Preview Split**: Load `/changes` in split mode → existing behavior unchanged
5. **Toggle button**: Works in both UIs, correct placement
6. **Collapsed files**: Expand collapsed file → table appears (MutationObserver)
7. `npm run build` succeeds without errors
