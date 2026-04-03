# Fix: CSV diff table visible when file is collapsed

## Context

Files changedタブで、ファイルを折りたたんでもCSV diffテーブルが表示され続ける不具合が2件報告されている。

1. **Classic UI + Preview UI**: ファイルを折りたたんでもCSV diffテーブルが消えない
2. **Preview UI のみ**: 折りたたんだ後に展開すると、テーブルの下にraw diffも表示されてしまう

**根本原因**: `injectTableOverlay()` が `wrapper` を `diffBody` の**兄弟要素**として挿入している。GitHubの折りたたみ機構は `diffBody` を非表示にするが、兄弟の `wrapper` には影響しない。

## GitHub Preview UI の折りたたみ挙動 (実機調査結果)

- 折りたたみ時: GitHubは **diffBody (2番目の子要素) をDOMから完全に削除** する
- コンテナ (`div[id^="diff-"][role="region"]`) 自体と header (1番目の子要素) は残る
- 展開時: 新しいdiffBodyをDOMに追加する (wrapper等の注入要素は消失)
- Classic UIは `open` class の付け外しで `.js-file-content` を表示/非表示 (DOM破壊なし)

## Approach

`wrapper` を `diffBody` の兄弟ではなく、**子要素として内部に挿入**する。これにより、GitHubが `diffBody` を非表示/削除すると `wrapper` も一緒に隠れる/消える。

加えて、**CSSルールで再展開時のraw diff flash を防止**する。Preview UIで展開すると新しいdiffBodyが生成され、MutationObserver (300ms debounce) による再処理の間にraw diffが一瞬見えてしまう問題を、`data-csv-diff-processed` 属性を保持したままCSSで即座に非表示にすることで解決。

### 変更前のDOM構造:
```
container
  ├── header (toggle button)
  ├── wrapper (.csv-diff-wrapper) ← diffBodyの兄弟 (問題の原因)
  └── diffBody (style.display="none")
```

### 変更後のDOM構造:
```
container [data-csv-diff-processed]
  ├── header (toggle button)
  └── diffBody (GitHubの折りたたみで非表示/削除される)
      ├── wrapper (.csv-diff-wrapper) ← diffBodyの子要素
      └── [元のdiffコンテンツ] (style.display="none")
```

## Changes

**修正対象**: `src/content/observer.ts`, `src/styles/diff-table.css`

### 1. `processExistingDiffs()` — 再展開時の再処理ロジック追加

Line 41 の `if (container.hasAttribute(PROCESSED_ATTR)) continue;` を以下に置換:

```typescript
if (container.hasAttribute(PROCESSED_ATTR)) {
  // Check if wrapper still exists (GitHub may rebuild diffBody on re-expand)
  const existingWrapper = container.querySelector(".csv-diff-wrapper");
  if (existingWrapper) continue;

  // Wrapper is gone — clean up stale elements and fall through to re-process.
  // Keep PROCESSED_ATTR so CSS can hide raw diff content during re-expand.
  container.removeAttribute("data-csv-diff-raw");
  const staleToggle = container.querySelector(".csv-diff-toggle-btn");
  if (staleToggle) staleToggle.remove();
}
```

**要点**:
- `PROCESSED_ATTR` を**削除しない**。削除するとCSSの flash 防止ルールが無効になるため。
- `data-csv-diff-raw` と stale な toggle button のみクリーンアップし、フォールスルーで再処理。
- フォールスルー先の `processCsvDiffBlock` が `PROCESSED_ATTR` を再設定するため、二重設定は問題なし。

### 2. `injectTableOverlay()` — wrapper挿入位置とtoggleロジックの変更

```typescript
function injectTableOverlay(
  container: HTMLElement,
  tableElement: HTMLElement,
  config: UiConfig
): boolean {
  const header = container.querySelector<HTMLElement>(config.headerSelector);
  const diffBody = container.querySelector<HTMLElement>(config.contentSelector);

  if (!header || !diffBody) {
    console.warn("[GitHub Better CSV Diff] Could not find header/body in container");
    return false;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "csv-diff-wrapper";
  wrapper.appendChild(tableElement);

  // Capture original children before prepending wrapper
  const originalChildren = Array.from(diffBody.children) as HTMLElement[];

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "csv-diff-toggle-btn btn btn-sm csv-diff-toggle-active";
  toggleBtn.textContent = "Raw Diff";
  toggleBtn.type = "button";

  toggleBtn.addEventListener("click", () => {
    const isTableVisible = wrapper.style.display !== "none";
    wrapper.style.display = isTableVisible ? "none" : "";
    for (const child of originalChildren) {
      child.style.display = isTableVisible ? "" : "none";
    }
    toggleBtn.textContent = isTableVisible ? "Table View" : "Raw Diff";
    toggleBtn.classList.toggle("csv-diff-toggle-active", !isTableVisible);
    // Toggle raw mode attribute so CSS stops hiding original content
    if (isTableVisible) {
      container.setAttribute("data-csv-diff-raw", "");
    } else {
      container.removeAttribute("data-csv-diff-raw");
    }
  });

  const actionsArea = header.querySelector<HTMLElement>(config.actionsSelector);
  if (actionsArea) {
    actionsArea.prepend(toggleBtn);
  } else {
    header.appendChild(toggleBtn);
  }

  // Place wrapper inside diffBody and hide original content.
  // When GitHub collapses the file (hiding diffBody), wrapper is hidden too.
  for (const child of originalChildren) {
    child.style.display = "none";
  }
  diffBody.prepend(wrapper);
  return true;
}
```

**変更点のまとめ**:
- `container.insertBefore(wrapper, diffBody)` → `diffBody.prepend(wrapper)`
- `diffBody.style.display = "none"` → `originalChildren` 各要素を `display: none`
- toggle handler: `diffBody.style.display` の切り替え → `originalChildren` の `display` 切り替え
- toggle handler: `data-csv-diff-raw` 属性の切り替えを追加 (CSS flash 防止との連携)

### 3. `diff-table.css` — Preview UI 再展開時の raw diff flash 防止

```css
/* Prevent raw diff flash when Preview UI rebuilds DOM on re-expand.
   Hides non-wrapper children immediately via CSS, before JS re-processes. */
[data-csv-diff-processed][role="region"]:not([data-csv-diff-raw]) > :nth-child(2) > :not(.csv-diff-wrapper) {
  display: none;
}
```

**仕組み**:
- Preview UI コンテナ (`[role="region"]`) の2番目の子要素 (diffBody) 内で、`.csv-diff-wrapper` 以外を非表示
- `data-csv-diff-processed` が維持されているため、GitHub が新 diffBody を追加した瞬間に発動
- `data-csv-diff-raw` が設定されている場合 (Raw Diff モード) は無効化される

## Why this works

| シナリオ | 動作 |
|---|---|
| Classic UI 折りたたみ | `open` class除去 → `.js-file-content` (diffBody) 非表示 → 内部のwrapperも非表示 |
| Classic UI 展開 | `.js-file-content` 再表示 → wrapperと元コンテンツのtoggle状態維持 |
| Preview UI 折りたたみ | diffBody DOM削除 → wrapper消失、`PROCESSED_ATTR` は維持 |
| Preview UI 展開 | 新diffBody追加 → CSS即時発動でraw diff非表示 → JS再処理でtable注入 |
| Preview UI 展開 (DOM維持の場合) | diffBody再表示 → toggle状態維持 |

## Selector collision safety

`renderDiffTable()` は `div.csv-diff-container` を返す。内部テーブルにも `role="grid"` や `.diff-table` は付いていない。よって `config.tableSelector` (`table[role="grid"]` / `table.diff-table`) がdiffBody内で検索しても、我々の注入要素にはマッチしない。

## Known limitation

Preview UI での展開/折りたたみ時に、toggle ボタンとテーブルの表示/非表示に ~0.5s の遅延がある。MutationObserver の 300ms debounce + 再処理時間に起因する構造的な制約。issue #5 として記録済み。

## Verification

1. `npm run build` でビルド
2. `chrome://extensions` で拡張を再読み込み
3. https://github.com/letconst/github-better-csv-diff/pull/2/files を開く
4. 以下を確認:
   - [x] Classic UI: ファイル折りたたみ → テーブルが非表示になること
   - [x] Classic UI: 再展開 → テーブルが正しく表示されること
   - [x] Preview UI: ファイル折りたたみ → テーブルが非表示になること
   - [x] Preview UI: 再展開 → テーブルのみ表示され、raw diffが表示されないこと
   - [x] 両UI: Table View / Raw Diff トグルが正常に動作すること
   - [ ] 両UI: トグルでRaw Diff表示中に折りたたみ→展開 → Raw Diff状態が維持されること
