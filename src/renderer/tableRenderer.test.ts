// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  type CsvDiff,
  type DiffAlignment,
  type DiffLine,
  diffToCsv,
} from "../parser/diffParser";
import { renderDiffTable, type SideHeaderMode } from "./tableRenderer";

const NBSP = " ";

const same = (oldN: number, newN: number): DiffAlignment => ({
  type: "unchanged",
  oldLineNumber: oldN,
  newLineNumber: newN,
});
const gone = (oldN: number): DiffAlignment => ({
  type: "removed",
  oldLineNumber: oldN,
  newLineNumber: null,
});
const came = (newN: number): DiffAlignment => ({
  type: "added",
  oldLineNumber: null,
  newLineNumber: newN,
});

function csvDiff(
  before: string[][],
  after: string[][],
  beforeLineNumbers: Array<number | null>,
  afterLineNumbers: Array<number | null>,
  alignment: DiffAlignment[] = [],
): CsvDiff {
  return { before, after, beforeLineNumbers, afterLineNumbers, alignment };
}

const sides = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>(".csv-diff-side"),
];
const bodyRows = (el: HTMLElement, i: 0 | 1) => [
  ...sides(el)[i]!.querySelectorAll<HTMLTableRowElement>(
    ".csv-diff-body-table tbody tr",
  ),
];
const headerCells = (el: HTMLElement, i: 0 | 1) => [
  ...sides(el)[i]!.querySelectorAll<HTMLElement>(
    ".csv-diff-header-table thead th",
  ),
];
const headerTexts = (el: HTMLElement, i: 0 | 1) =>
  headerCells(el, i).map((th) => th.textContent);
const rowKind = (tr: Element) =>
  [...tr.classList].find((c) => c.startsWith("csv-diff-row-")) ?? "";
const dataCells = (tr: Element) => [...tr.children].slice(1) as HTMLElement[];
const lineNum = (tr: Element) => tr.children[0]!.textContent;
const values = (tr: Element) => dataCells(tr).map((td) => td.textContent);
const hasClass = (cls: string) => (td: Element) => td.classList.contains(cls);
const brCount = (td: Element) => td.querySelectorAll("br").length;
const indicators = (td: Element) =>
  td.querySelectorAll(".csv-diff-newline-indicator").length;

describe("renderDiffTable: structure", () => {
  it("renders a Before side and an After side", () => {
    const el = renderDiffTable(
      csvDiff(
        [["id"], ["1"]],
        [["id"], ["1"]],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    expect(el.className).toBe("csv-diff-container");
    expect(
      sides(el).map((s) => s.querySelector(".csv-diff-header")!.textContent),
    ).toEqual(["Before", "After"]);
  });
});

describe("renderDiffTable: header modes", () => {
  const diff = csvDiff(
    [
      ["h1", "h2"],
      ["a", "b"],
    ],
    [
      ["h1", "h2"],
      ["a", "b"],
    ],
    [1, 2],
    [1, 2],
    [same(1, 1), same(2, 2)],
  );
  // Hunk that starts mid-file: line 1 is not in the diff.
  const midFile = csvDiff(
    [
      ["a", "b"],
      ["c", "d"],
    ],
    [
      ["a", "b"],
      ["c", "d"],
    ],
    [5, 6],
    [5, 6],
    [same(5, 5), same(6, 6)],
  );

  it("default: first row is the header and data starts at row 2", () => {
    const el = renderDiffTable(diff);
    for (const i of [0, 1] as const) {
      expect(headerTexts(el, i)).toEqual(["#", "h1", "h2"]);
      expect(bodyRows(el, i).map(values)).toEqual([["a", "b"]]);
      expect(bodyRows(el, i).map(lineNum)).toEqual(["2"]);
    }
  });

  it("external: provided headers are shown and all rows are data", () => {
    const el = renderDiffTable(midFile, {
      before: { mode: "external", headers: ["X", "Y"] },
      after: { mode: "external", headers: ["X", "Y"] },
    });
    for (const i of [0, 1] as const) {
      expect(headerTexts(el, i)).toEqual(["#", "X", "Y"]);
      expect(bodyRows(el, i).map(values)).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
      expect(bodyRows(el, i).map(lineNum)).toEqual(["5", "6"]);
    }
  });

  it("loading: shows a single Loading... placeholder and treats all rows as data", () => {
    const el = renderDiffTable(midFile, {
      before: { mode: "loading" },
      after: { mode: "loading" },
    });
    for (const i of [0, 1] as const) {
      const ths = headerCells(el, i);
      expect(ths).toHaveLength(1);
      expect(ths[0]!.textContent).toBe("Loading...");
      expect(ths[0]!.classList.contains("csv-diff-loading")).toBe(true);
      expect(bodyRows(el, i)).toHaveLength(2);
    }
  });

  it("resolves each side independently (before external, after default)", () => {
    const el = renderDiffTable(diff, {
      before: { mode: "external", headers: ["X", "Y"] },
    });
    expect(headerTexts(el, 0)).toEqual(["#", "X", "Y"]);
    expect(headerTexts(el, 1)).toEqual(["#", "h1", "h2"]);
    // Before keeps the diff's first row as data; After consumes it as header.
    expect(bodyRows(el, 0).map(values)).toContainEqual(["h1", "h2"]);
    expect(bodyRows(el, 1).map(values)).not.toContainEqual(["h1", "h2"]);
  });

  it("loading on one side leaves the other side's header untouched", () => {
    const el = renderDiffTable(diff, { before: { mode: "loading" } });
    expect(headerTexts(el, 0)).toEqual(["Loading..."]);
    expect(el.querySelectorAll(".csv-diff-loading")).toHaveLength(1);
    expect(headerTexts(el, 1)).toEqual(["#", "h1", "h2"]);
  });
});

describe("renderDiffTable: modified rows", () => {
  const header = ["id", "name", "dept"];
  const diff = csvDiff(
    [header, ["1", "Alice Johnson", "Sales"]],
    [header, ["1", "Alice Johnsen", "Engineering and more words"]],
    [1, 2],
    [1, 2],
    [same(1, 1), gone(2), came(2)],
  );

  it("renders both sides of the row and marks only the changed cells", () => {
    const el = renderDiffTable(diff);
    const b = bodyRows(el, 0)[0]!;
    const a = bodyRows(el, 1)[0]!;
    expect(rowKind(b)).toBe("");
    expect(rowKind(a)).toBe("");
    expect(lineNum(b)).toBe("2");
    expect(lineNum(a)).toBe("2");
    expect(dataCells(b).map(hasClass("csv-diff-cell-removed"))).toEqual([
      false,
      true,
      true,
    ]);
    expect(dataCells(a).map(hasClass("csv-diff-cell-changed"))).toEqual([
      false,
      true,
      true,
    ]);
    expect(b.children[0]!.classList.contains("csv-diff-line-num-removed")).toBe(
      true,
    );
    expect(a.children[0]!.classList.contains("csv-diff-line-num-added")).toBe(
      true,
    );
  });

  it("highlights the differing word when the edit is small", () => {
    const el = renderDiffTable(diff);
    const nameBefore = dataCells(bodyRows(el, 0)[0]!)[1]!;
    const nameAfter = dataCells(bodyRows(el, 1)[0]!)[1]!;
    expect(nameBefore.textContent).toBe("Alice Johnson");
    expect(nameAfter.textContent).toBe("Alice Johnsen");
    expect(
      [...nameBefore.querySelectorAll(".csv-diff-inline-removed")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Johnson"]);
    expect(
      [...nameAfter.querySelectorAll(".csv-diff-inline-added")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["Johnsen"]);
  });

  it("omits inline highlights when the value was replaced wholesale", () => {
    const el = renderDiffTable(diff);
    const deptBefore = dataCells(bodyRows(el, 0)[0]!)[2]!;
    const deptAfter = dataCells(bodyRows(el, 1)[0]!)[2]!;
    expect(deptBefore.textContent).toBe("Sales");
    expect(deptAfter.textContent).toBe("Engineering and more words");
    expect(deptBefore.querySelector(".csv-diff-inline-removed")).toBeNull();
    expect(deptAfter.querySelector(".csv-diff-inline-added")).toBeNull();
  });

  it("leaves an identical row unmarked", () => {
    const row = ["1", "A", "B"];
    const el = renderDiffTable(
      csvDiff(
        [header, row],
        [header, row],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    expect(rowKind(bodyRows(el, 1)[0]!)).toBe("");
    expect(el.querySelector(".csv-diff-cell-changed")).toBeNull();
    expect(el.querySelector(".csv-diff-cell-removed")).toBeNull();
    expect(el.querySelector(".csv-diff-line-num-added")).toBeNull();
  });
});

describe("renderDiffTable: added and removed rows", () => {
  const header = ["id", "name"];

  it("added row: blank on Before, added with its line number on After", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "A"]],
        [header, ["1", "A"], ["2", "B"]],
        [1, 2],
        [1, 2, 3],
        [same(1, 1), same(2, 2), came(3)],
      ),
    );
    expect(bodyRows(el, 0).map(rowKind)).toEqual(["", "csv-diff-row-empty"]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual(["", "csv-diff-row-added"]);
    expect(bodyRows(el, 0).map(lineNum)).toEqual(["2", NBSP]);
    expect(bodyRows(el, 1).map(lineNum)).toEqual(["2", "3"]);
    expect(values(bodyRows(el, 0)[1]!)).toEqual([NBSP, NBSP]);
    expect(values(bodyRows(el, 1)[1]!)).toEqual(["2", "B"]);
  });

  it("removed row: removed with its line number on Before, blank on After", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "A"], ["2", "B"]],
        [header, ["1", "A"]],
        [1, 2, 3],
        [1, 2],
        [same(1, 1), same(2, 2), gone(3)],
      ),
    );
    expect(bodyRows(el, 0).map(rowKind)).toEqual(["", "csv-diff-row-removed"]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual(["", "csv-diff-row-empty"]);
    expect(bodyRows(el, 0).map(lineNum)).toEqual(["2", "3"]);
    expect(bodyRows(el, 1).map(lineNum)).toEqual(["2", NBSP]);
    expect(values(bodyRows(el, 1)[1]!)).toEqual([NBSP, NBSP]);
  });

  it("both sides always render the same number of rows", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "A"], ["2", "B"]],
        [header, ["1", "A"], ["3", "C"], ["4", "D"]],
        [1, 2, 3],
        [1, 2, 3, 4],
        [same(1, 1), same(2, 2), gone(3), came(3), came(4)],
      ),
    );
    expect(bodyRows(el, 0)).toHaveLength(bodyRows(el, 1).length);
    const keys = (i: 0 | 1) =>
      bodyRows(el, i)
        .filter((tr) => rowKind(tr) !== "csv-diff-row-empty")
        .map((tr) => values(tr)[0]);
    expect(keys(0)).toEqual(["1", "2"]);
    expect(keys(1)).toEqual(["1", "3", "4"]);
  });
});

describe("renderDiffTable: column-count change", () => {
  // After gains a column. The header lines differ, so the header is a
  // removed+added pair that falls outside the data rows.
  const diff = csvDiff(
    [
      ["id", "name"],
      ["1", "A"],
    ],
    [
      ["id", "name", "price"],
      ["1", "A", "10"],
    ],
    [1, 2],
    [1, 2],
    [gone(1), came(1), gone(2), came(2)],
  );

  it("pads both sides to the widest row, header included", () => {
    const el = renderDiffTable(diff);
    expect(headerTexts(el, 0)).toEqual(["#", "id", "name", ""]);
    expect(headerTexts(el, 1)).toEqual(["#", "id", "name", "price"]);
    expect(values(bodyRows(el, 0)[0]!)).toEqual(["1", "A", ""]);
    expect(values(bodyRows(el, 1)[0]!)).toEqual(["1", "A", "10"]);
  });

  it("marks the padded cell on the short side removed and the new cell changed", () => {
    const el = renderDiffTable(diff);
    expect(
      dataCells(bodyRows(el, 0)[0]!).map(hasClass("csv-diff-cell-removed")),
    ).toEqual([false, false, true]);
    expect(
      dataCells(bodyRows(el, 1)[0]!).map(hasClass("csv-diff-cell-changed")),
    ).toEqual([false, false, true]);
  });
});

describe("renderDiffTable: multiline cells", () => {
  const header = ["id", "note"];

  it("renders each newline of an unchanged cell as <br> plus an indicator", () => {
    const row = ["1", "a\nb\nc"];
    const el = renderDiffTable(
      csvDiff(
        [header, row],
        [header, row],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    for (const i of [0, 1] as const) {
      const td = dataCells(bodyRows(el, i)[0]!)[1]!;
      expect(brCount(td)).toBe(2);
      expect(indicators(td)).toBe(2);
      expect(td.textContent).toBe("abc");
    }
  });

  it("gives both sides of a modified cell the same <br> count when line counts match", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "first line\nsecond line"]],
        [header, ["1", "first line\nsecond lane"]],
        [1, 2],
        [1, 2],
        [same(1, 1), gone(2), came(2)],
      ),
    );
    const before = dataCells(bodyRows(el, 0)[0]!)[1]!;
    const after = dataCells(bodyRows(el, 1)[0]!)[1]!;
    expect(brCount(before)).toBe(1);
    expect(brCount(after)).toBe(1);
    expect(indicators(before)).toBe(1);
    expect(indicators(after)).toBe(1);
  });

  it("renders one <br> per newline on each side when a line is added", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "one\ntwo"]],
        [header, ["1", "one\ntwo\nthree"]],
        [1, 2],
        [1, 2],
        [same(1, 1), gone(2), came(2)],
      ),
    );
    const before = dataCells(bodyRows(el, 0)[0]!)[1]!;
    const after = dataCells(bodyRows(el, 1)[0]!)[1]!;
    expect(brCount(before)).toBe(1);
    expect(brCount(after)).toBe(2);
    expect(after.textContent).toBe("onetwothree");
  });

  it("treats CRLF as one newline", () => {
    const row = ["1", "a\r\nb"];
    const el = renderDiffTable(
      csvDiff(
        [header, row],
        [header, row],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    expect(brCount(dataCells(bodyRows(el, 0)[0]!)[1]!)).toBe(1);
  });

  it("renders a multiline header cell with <br>", () => {
    const row = ["1", "x"];
    const head = ["id", "two\nlines"];
    const el = renderDiffTable(
      csvDiff(
        [head, row],
        [head, row],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    expect(brCount(headerCells(el, 0)[2]!)).toBe(1);
  });
});

describe("renderDiffTable: cell text is never parsed as HTML", () => {
  it("renders HTML-like text in unchanged and header cells as text", () => {
    const head = ["id", "<i>h</i>"];
    const row = ["1", "<b>x</b>"];
    const el = renderDiffTable(
      csvDiff(
        [head, row],
        [head, row],
        [1, 2],
        [1, 2],
        [same(1, 1), same(2, 2)],
      ),
    );
    expect(dataCells(bodyRows(el, 0)[0]!)[1]!.textContent).toBe("<b>x</b>");
    expect(headerCells(el, 0)[2]!.textContent).toBe("<i>h</i>");
    expect(el.querySelector("b, i")).toBeNull();
  });

  it("renders HTML-like text in modified cells (with inline highlight) as text", () => {
    const header = ["id", "html"];
    const el = renderDiffTable(
      csvDiff(
        [header, ["1", "<b>x</b>"]],
        [header, ["1", "<b>y</b>"]],
        [1, 2],
        [1, 2],
        [same(1, 1), gone(2), came(2)],
      ),
    );
    expect(dataCells(bodyRows(el, 0)[0]!)[1]!.textContent).toBe("<b>x</b>");
    expect(dataCells(bodyRows(el, 1)[0]!)[1]!.textContent).toBe("<b>y</b>");
    expect(el.querySelector("b")).toBeNull();
  });
});

describe("renderDiffTable: row matching precedence", () => {
  const header = ["key", "val"];

  it("alignment: rows follow the diff order; a moved row is removed at its old place and added at its new place", () => {
    // before: h A B C   after: h C A B   (C moved to the top)
    const el = renderDiffTable(
      csvDiff(
        [header, ["A", "1"], ["B", "2"], ["C", "3"]],
        [header, ["C", "3"], ["A", "1"], ["B", "2"]],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [same(1, 1), came(2), same(2, 3), same(3, 4), gone(4)],
      ),
    );
    expect(bodyRows(el, 0).map(rowKind)).toEqual([
      "csv-diff-row-empty",
      "",
      "",
      "csv-diff-row-removed",
    ]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual([
      "csv-diff-row-added",
      "",
      "",
      "csv-diff-row-empty",
    ]);
    expect(bodyRows(el, 0).map(lineNum)).toEqual([NBSP, "2", "3", "4"]);
    expect(bodyRows(el, 1).map(lineNum)).toEqual(["2", "3", "4", NBSP]);
    expect(bodyRows(el, 1).map((tr) => values(tr)[0])).toEqual([
      "C",
      "A",
      "B",
      NBSP,
    ]);
  });

  it("key fallback: when the alignment does not cover the rows, rows pair by first-column key regardless of order", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["k1", "a"], ["k2", "b"]],
        [header, ["k2", "b2"], ["k1", "a"]],
        [1, 2, 3],
        [1, 2, 3],
        [],
      ),
    );
    expect(bodyRows(el, 0).map(values)).toEqual([
      ["k1", "a"],
      ["k2", "b"],
    ]);
    expect(bodyRows(el, 1).map(values)).toEqual([
      ["k1", "a"],
      ["k2", "b2"],
    ]);
    expect(bodyRows(el, 0).map(lineNum)).toEqual(["2", "3"]);
    expect(bodyRows(el, 1).map(lineNum)).toEqual(["3", "2"]);
    expect(el.querySelectorAll(".csv-diff-cell-changed")).toHaveLength(1);
    expect(
      dataCells(bodyRows(el, 1)[1]!).map(hasClass("csv-diff-cell-changed")),
    ).toEqual([false, true]);
  });

  it("key fallback: unmatched keys become added and removed rows", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["k1", "a"], ["k2", "b"]],
        [header, ["k3", "c"], ["k1", "a"]],
        [1, 2, 3],
        [1, 2, 3],
        [],
      ),
    );
    expect(bodyRows(el, 0).map(rowKind)).toEqual([
      "csv-diff-row-empty",
      "",
      "csv-diff-row-removed",
    ]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual([
      "csv-diff-row-added",
      "",
      "csv-diff-row-empty",
    ]);
  });

  it("key fallback: a partial alignment still renders every row, paired by key", () => {
    // Alignment covers only the header and k1; k2 and k3 are unaccounted for.
    const el = renderDiffTable(
      csvDiff(
        [header, ["k1", "a"], ["k2", "b"], ["k3", "c"]],
        [header, ["k3", "c2"], ["k1", "a"], ["k2", "b"]],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [same(1, 1), same(2, 3)],
      ),
    );
    expect(bodyRows(el, 0).map(values)).toEqual([
      ["k1", "a"],
      ["k2", "b"],
      ["k3", "c"],
    ]);
    expect(bodyRows(el, 1).map(values)).toEqual([
      ["k1", "a"],
      ["k2", "b"],
      ["k3", "c2"],
    ]);
    expect(bodyRows(el, 0).map(lineNum)).toEqual(["2", "3", "4"]);
    expect(bodyRows(el, 1).map(lineNum)).toEqual(["3", "4", "2"]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual(["", "", ""]);
  });

  it("aligned 1R/1A with an edited first-column key renders one modified row (#30)", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["A", "1"]],
        [header, ["A2", "1"]],
        [1, 2],
        [1, 2],
        [same(1, 1), gone(2), came(2)],
      ),
    );
    expect(bodyRows(el, 0)).toHaveLength(1);
    expect(bodyRows(el, 0).map(rowKind)).toEqual([""]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual([""]);
    expect(
      dataCells(bodyRows(el, 0)[0]!).map(hasClass("csv-diff-cell-removed")),
    ).toEqual([true, false]);
    expect(
      dataCells(bodyRows(el, 1)[0]!).map(hasClass("csv-diff-cell-changed")),
    ).toEqual([true, false]);
  });

  it("order fallback: empty first-column keys are duplicates, so rows pair by index", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["", "a"], ["", "b"]],
        [header, ["", "a"], ["", "b2"]],
        [1, 2, 3],
        [1, 2, 3],
        [],
      ),
    );
    expect(bodyRows(el, 0).map(values)).toEqual([
      ["", "a"],
      ["", "b"],
    ]);
    expect(bodyRows(el, 1).map(values)).toEqual([
      ["", "a"],
      ["", "b2"],
    ]);
    expect(bodyRows(el, 0).map(rowKind)).toEqual(["", ""]);
    expect(el.querySelectorAll(".csv-diff-cell-changed")).toHaveLength(1);
  });

  it("a fully reversed replacement block (crossing matches) stays in diff order: removed rows, then added rows", () => {
    // Key pairing needs a monotonic order; reversed keys are not, so the block
    // keeps its diff order instead of pairing.
    const el = renderDiffTable(
      csvDiff(
        [header, ["A", "1"], ["B", "2"], ["C", "3"]],
        [header, ["C", "3"], ["B", "2"], ["A", "1"]],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [same(1, 1), gone(2), gone(3), gone(4), came(2), came(3), came(4)],
      ),
    );
    const e = "csv-diff-row-empty";
    const r = "csv-diff-row-removed";
    const a = "csv-diff-row-added";
    expect(bodyRows(el, 0).map(rowKind)).toEqual([r, r, r, e, e, e]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual([e, e, e, a, a, a]);
    expect(
      bodyRows(el, 0)
        .slice(0, 3)
        .map((tr) => values(tr)[0]),
    ).toEqual(["A", "B", "C"]);
    expect(
      bodyRows(el, 1)
        .slice(3)
        .map((tr) => values(tr)[0]),
    ).toEqual(["C", "B", "A"]);
  });

  it("order fallback: duplicate first-column keys pair by index", () => {
    const el = renderDiffTable(
      csvDiff(
        [header, ["d", "1"], ["d", "2"], ["d", "3"]],
        [header, ["d", "9"], ["d", "2"]],
        [1, 2, 3, 4],
        [1, 2, 3],
        [],
      ),
    );
    expect(bodyRows(el, 0).map(values)).toEqual([
      ["d", "1"],
      ["d", "2"],
      ["d", "3"],
    ]);
    expect(bodyRows(el, 1).map(values)).toEqual([
      ["d", "9"],
      ["d", "2"],
      [NBSP, NBSP],
    ]);
    expect(bodyRows(el, 0).map(rowKind)).toEqual([
      "",
      "",
      "csv-diff-row-removed",
    ]);
    expect(bodyRows(el, 1).map(rowKind)).toEqual([
      "",
      "",
      "csv-diff-row-empty",
    ]);
    expect(
      dataCells(bodyRows(el, 1)[0]!).map(hasClass("csv-diff-cell-changed")),
    ).toEqual([false, true]);
    expect(
      dataCells(bodyRows(el, 1)[1]!).map(hasClass("csv-diff-cell-changed")),
    ).toEqual([false, false]);
  });
});

describe("renderDiffTable: edit on a continuation line of a multiline record", () => {
  it("renders the record as modified although the alignment marks its first physical line unchanged", () => {
    const lines: DiffLine[] = [
      {
        type: "unchanged",
        content: "id,note",
        oldLineNumber: 1,
        newLineNumber: 1,
      },
      {
        type: "unchanged",
        content: '1,"line1',
        oldLineNumber: 2,
        newLineNumber: 2,
      },
      {
        type: "removed",
        content: 'line2"',
        oldLineNumber: 3,
        newLineNumber: null,
      },
      {
        type: "added",
        content: 'lineX"',
        oldLineNumber: null,
        newLineNumber: 3,
      },
    ];
    const el = renderDiffTable(diffToCsv(lines));
    expect(bodyRows(el, 0)).toHaveLength(1);
    const before = dataCells(bodyRows(el, 0)[0]!)[1]!;
    const after = dataCells(bodyRows(el, 1)[0]!)[1]!;
    expect(before.classList.contains("csv-diff-cell-removed")).toBe(true);
    expect(after.classList.contains("csv-diff-cell-changed")).toBe(true);
    expect(before.textContent).toBe("line1line2");
    expect(after.textContent).toBe("line1lineX");
    expect(brCount(before)).toBe(1);
    expect(brCount(after)).toBe(1);
    expect(lineNum(bodyRows(el, 0)[0]!)).toBe("2");
  });
});

describe("renderDiffTable: missing line numbers", () => {
  it("renders null line numbers as empty (non-breaking space) cells", () => {
    const external: SideHeaderMode = { mode: "external", headers: ["x", "y"] };
    const el = renderDiffTable(
      csvDiff([["a", "b"]], [["a", "b"]], [null], [null]),
      { before: external, after: external },
    );
    expect(lineNum(bodyRows(el, 0)[0]!)).toBe(NBSP);
    expect(lineNum(bodyRows(el, 1)[0]!)).toBe(NBSP);
    expect(values(bodyRows(el, 0)[0]!)).toEqual(["a", "b"]);
  });
});
