// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDiffTable } from "../renderer/tableRenderer";
import {
  type DiffLine,
  diffToCsv,
  extractDiffLinesFromDom,
  getFirstLineNumbers,
} from "./diffParser";
import { CLASSIC_UI, PREVIEW_UI, type UiConfig } from "./uiConfig";

const fixtureRoot = resolve(import.meta.dirname, "../../test/fixtures");
const NBSP = " ";

const readLines = (name: string): string[] =>
  readFileSync(resolve(fixtureRoot, "csv", name), "utf8")
    .split("\n")
    .filter((line) => line !== "");

function loadContainer(fixture: string, selector: string): HTMLElement {
  document.body.innerHTML = readFileSync(
    resolve(fixtureRoot, "github", `${fixture}.html`),
    "utf8",
  );
  const container = document.body.querySelector<HTMLElement>(selector);
  if (!container) throw new Error(`no ${selector} in ${fixture}`);
  return container;
}

interface UiFixture {
  selector: string;
  config: UiConfig;
}
const CLASSIC: UiFixture = { selector: "div.file.js-file", config: CLASSIC_UI };
const PREVIEW: UiFixture = {
  selector: 'div[role="region"]',
  config: PREVIEW_UI,
};

const extractedCache = new Map<string, DiffLine[]>();
function extracted(fixture: string, ui: UiFixture): DiffLine[] {
  let lines = extractedCache.get(fixture);
  if (!lines) {
    lines = extractDiffLinesFromDom(
      loadContainer(fixture, ui.selector),
      ui.config,
    );
    extractedCache.set(fixture, lines);
  }
  return lines;
}

/**
 * Expected DiffLines take their content from the CSV pair ("the Nth physical
 * line of the file"), not from parser output.
 */
function diffLineFactory(beforeFile: string, afterFile: string) {
  const before = readLines(beforeFile);
  const after = readLines(afterFile);
  return {
    unchanged: (oldN: number, newN: number): DiffLine => {
      expect(before[oldN - 1]).toBe(after[newN - 1]);
      return {
        type: "unchanged",
        content: before[oldN - 1]!,
        oldLineNumber: oldN,
        newLineNumber: newN,
      };
    },
    removed: (oldN: number): DiffLine => ({
      type: "removed",
      content: before[oldN - 1]!,
      oldLineNumber: oldN,
      newLineNumber: null,
    }),
    added: (newN: number): DiffLine => ({
      type: "added",
      content: after[newN - 1]!,
      oldLineNumber: null,
      newLineNumber: newN,
    }),
  };
}

const beforeSide = (lines: DiffLine[]) =>
  lines.filter((l) => l.type !== "added");
const afterSide = (lines: DiffLine[]) =>
  lines.filter((l) => l.type !== "removed");

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("extractDiffLinesFromDom: Classic UI (sample.csv, PR #2)", () => {
  const {
    unchanged: u,
    removed: r,
    added: a,
  } = diffLineFactory("sample.before.csv", "sample.after.csv");

  // Unified lists every removal of a change block before its additions.
  // The hunk header row yields nothing.
  const unifiedExpected = [
    u(1, 1),
    r(2),
    a(2),
    u(3, 3),
    r(4),
    r(5),
    a(4),
    u(6, 5),
    r(7),
    a(6),
    a(7),
    a(8),
  ];

  // Split puts a removed line and its replacement on one row, so Diana's
  // deletion (own row) follows the Charlie/Charles pair.
  const splitExpected = [
    u(1, 1),
    r(2),
    a(2),
    u(3, 3),
    r(4),
    a(4),
    r(5),
    u(6, 5),
    r(7),
    a(6),
    a(7),
    a(8),
  ];

  it("extracts every unified line in order, skipping the hunk row", () => {
    expect(extracted("classic-pr-unified", CLASSIC)).toEqual(unifiedExpected);
  });

  it("extracts every split line in order, skipping the hunk row", () => {
    expect(extracted("classic-pr-split", CLASSIC)).toEqual(splitExpected);
  });

  // Strict DiffLine[] equality does not hold: the two layouts order a change
  // block differently. What must hold is that both reconstruct the same files.
  it("reconstructs the same before and after files from either layout", () => {
    const split = extracted("classic-pr-split", CLASSIC);
    const unified = extracted("classic-pr-unified", CLASSIC);
    expect(beforeSide(split)).toEqual(beforeSide(unified));
    expect(afterSide(split)).toEqual(afterSide(unified));
    expect(beforeSide(split).map((l) => l.content)).toEqual(
      readLines("sample.before.csv"),
    );
    expect(afterSide(split).map((l) => l.content)).toEqual(
      readLines("sample.after.csv"),
    );
  });
});

describe("extractDiffLinesFromDom: Preview UI (wide.csv, commit 20765189)", () => {
  const {
    unchanged: u,
    removed: r,
    added: a,
  } = diffLineFactory("wide.before.csv", "wide.after.csv");

  // Header and rows 1001/1003/1005 unchanged; 1002 and 1004 edited; 1006
  // replaced by 1007. Each edit is one removed+added pair in both layouts.
  const expected = [
    u(1, 1),
    u(2, 2),
    r(3),
    a(3),
    u(4, 4),
    r(5),
    a(5),
    u(6, 6),
    r(7),
    a(7),
  ];

  it("extracts every split line, stripping the +/- marker", () => {
    expect(extracted("preview-commit-split", PREVIEW)).toEqual(expected);
  });

  it("extracts every unified line, stripping the +/- marker", () => {
    expect(extracted("preview-commit-unified", PREVIEW)).toEqual(expected);
  });

  it("yields identical DiffLine[] from split and unified layouts", () => {
    expect(extracted("preview-commit-split", PREVIEW)).toEqual(
      extracted("preview-commit-unified", PREVIEW),
    );
  });
});

describe("extractDiffLinesFromDom: container without a diff table", () => {
  it.each<[string, UiConfig, string]>([
    ["Preview", PREVIEW_UI, '<div role="region"><h3>collapsed.csv</h3></div>'],
    ["Classic", CLASSIC_UI, '<div class="file js-file"></div>'],
  ])("returns [] and warns for a %s container", (_ui, config, html) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = html;
    const container = document.body.firstElementChild as HTMLElement;
    expect(extractDiffLinesFromDom(container, config)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

// Unit-level integration: GitHub DOM -> DiffLine[] -> CsvDiff -> rendered table.
// Expected rows come from the PR #2 pattern tables.
describe("pipeline: fixture to rendered table", () => {
  interface SideRows {
    classes: string[];
    lineNums: string[];
    cells: string[][];
    changed: boolean[][];
  }

  function sideRows(container: HTMLElement, index: 0 | 1): SideRows {
    const side = container.querySelectorAll(".csv-diff-side")[index]!;
    const trs = [...side.querySelectorAll("tbody tr")];
    const dataCells = (tr: Element) => [...tr.children].slice(1);
    return {
      classes: trs.map(
        (tr) =>
          [...tr.classList].find((c) => c.startsWith("csv-diff-row-")) ?? "",
      ),
      lineNums: trs.map((tr) => tr.children[0]!.textContent!),
      cells: trs.map((tr) => dataCells(tr).map((td) => td.textContent!)),
      changed: trs.map((tr) =>
        dataCells(tr).map((td) =>
          td.classList.contains("csv-diff-cell-changed"),
        ),
      ),
    };
  }

  interface Rendered {
    lines: DiffLine[];
    rendered: HTMLElement;
    before: SideRows;
    after: SideRows;
  }

  function renderFixture(fixture: string, ui: UiFixture): Rendered {
    const lines = extracted(fixture, ui);
    const rendered = renderDiffTable(diffToCsv(lines));
    return {
      lines,
      rendered,
      before: sideRows(rendered, 0),
      after: sideRows(rendered, 1),
    };
  }

  const headerTexts = (container: HTMLElement, index: 0 | 1) =>
    [
      ...container
        .querySelectorAll(".csv-diff-side")
        [index]!.querySelectorAll(".csv-diff-header-table th"),
    ].map((th) => th.textContent);

  describe.each(["classic-pr-split", "classic-pr-unified"])(
    "sample.csv from %s",
    (fixture) => {
      const { lines, rendered, before, after } = renderFixture(
        fixture,
        CLASSIC,
      );

      it("includes line 1 in the diff, so the in-diff header is used", () => {
        expect(getFirstLineNumbers(lines)).toEqual({
          firstBeforeLine: 1,
          firstAfterLine: 1,
        });
        const header = ["#", ...readLines("sample.before.csv")[0]!.split(",")];
        expect(headerTexts(rendered, 0)).toEqual(header);
        expect(headerTexts(rendered, 1)).toEqual(header);
      });

      it("renders Diana as removed and Grace/Hank as added, the rest paired in place", () => {
        // Rows: Alice, Bob, Charlie, Diana, Eve, Frank, Grace, Hank.
        expect(before.classes).toEqual([
          "",
          "",
          "",
          "csv-diff-row-removed",
          "",
          "",
          "csv-diff-row-empty",
          "csv-diff-row-empty",
        ]);
        expect(after.classes).toEqual([
          "",
          "",
          "",
          "csv-diff-row-empty",
          "",
          "",
          "csv-diff-row-added",
          "csv-diff-row-added",
        ]);
      });

      it("shows the physical line numbers of each file", () => {
        expect(before.lineNums).toEqual([
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          NBSP,
          NBSP,
        ]);
        expect(after.lineNums).toEqual([
          "2",
          "3",
          "4",
          NBSP,
          "5",
          "6",
          "7",
          "8",
        ]);
      });

      it("shows the cell values of each file", () => {
        // Physical lines: Alice is line 2 of both files, Diana line 5 of
        // before, Hank line 8 of after.
        const beforeCsv = readLines("sample.before.csv");
        const afterCsv = readLines("sample.after.csv");
        expect(before.cells[0]).toEqual(beforeCsv[1]!.split(","));
        expect(after.cells[0]).toEqual(afterCsv[1]!.split(","));
        expect(before.cells[3]![1]).toBe(beforeCsv[4]!.split(",")[1]);
        expect(after.cells[7]![1]).toBe(afterCsv[7]!.split(",")[1]);
      });

      it("marks only the edited cells (Alice: email, salary) and none for unchanged Bob", () => {
        expect(after.changed[0]).toEqual([false, false, true, false, true]);
        expect(after.changed[1]).toEqual([false, false, false, false, false]);
      });
    },
  );

  // PR #2 lists 1006 as deleted and 1007 as added, but #30 decided that a lone
  // removed+added block is shown as one modified row even when the keys differ.
  describe.each(["preview-commit-split", "preview-commit-unified"])(
    "wide.csv from %s",
    (fixture) => {
      const { lines, rendered, before, after } = renderFixture(
        fixture,
        PREVIEW,
      );

      it("includes line 1 in the diff, so no external headers are needed", () => {
        expect(getFirstLineNumbers(lines).firstBeforeLine).toBe(1);
        expect(headerTexts(rendered, 0)).toEqual([
          "#",
          ...readLines("wide.before.csv")[0]!.split(","),
        ]);
      });

      it("renders six rows per side with no added/removed/empty rows", () => {
        expect(before.classes).toEqual(Array(6).fill(""));
        expect(after.classes).toEqual(Array(6).fill(""));
        expect(before.lineNums).toEqual(["2", "3", "4", "5", "6", "7"]);
        expect(after.lineNums).toEqual(["2", "3", "4", "5", "6", "7"]);
      });

      it("pairs rows in diff order", () => {
        expect(before.cells.map((c) => c[0])).toEqual([
          "1001",
          "1002",
          "1003",
          "1004",
          "1005",
          "1006",
        ]);
        expect(after.cells.map((c) => c[0])).toEqual([
          "1001",
          "1002",
          "1003",
          "1004",
          "1005",
          "1007",
        ]);
      });

      it("marks the edited cells of 1002 (title, salary, level, notes) only", () => {
        const columns = readLines("wide.before.csv")[0]!.split(",");
        const changedColumns = columns.filter((_, i) => after.changed[1]![i]);
        expect(changedColumns).toEqual(["title", "salary", "level", "notes"]);
      });
    },
  );
});
