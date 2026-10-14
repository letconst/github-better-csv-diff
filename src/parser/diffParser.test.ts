// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  type DiffLine,
  diffToCsv,
  getFirstLineNumbers,
  type HunkEntry,
} from "./diffParser";

const unchanged = (content: string, n: number, m = n): DiffLine => ({
  type: "unchanged",
  content,
  oldLineNumber: n,
  newLineNumber: m,
});
const removed = (content: string, n: number): DiffLine => ({
  type: "removed",
  content,
  oldLineNumber: n,
  newLineNumber: null,
});
const added = (content: string, n: number): DiffLine => ({
  type: "added",
  content,
  oldLineNumber: null,
  newLineNumber: n,
});

describe("getFirstLineNumbers", () => {
  it("reports null before-line for an added-only file", () => {
    expect(getFirstLineNumbers([added("a,b", 1), added("c,d", 2)])).toEqual({
      firstBeforeLine: null,
      firstAfterLine: 1,
    });
  });

  it("reports null after-line for a removed-only file", () => {
    expect(getFirstLineNumbers([removed("a,b", 1), removed("c,d", 2)])).toEqual(
      { firstBeforeLine: 1, firstAfterLine: null },
    );
  });

  it("uses the first line of a hunk that does not start at line 1", () => {
    expect(getFirstLineNumbers([removed("a,b", 40), added("a,c", 42)])).toEqual(
      { firstBeforeLine: 40, firstAfterLine: 42 },
    );
  });

  it("takes both numbers from an unchanged line", () => {
    expect(
      getFirstLineNumbers([unchanged("a,b", 8, 10), added("x", 11)]),
    ).toEqual({ firstBeforeLine: 8, firstAfterLine: 10 });
  });

  it("reports nulls for no lines", () => {
    expect(getFirstLineNumbers([])).toEqual({
      firstBeforeLine: null,
      firstAfterLine: null,
    });
  });
});

describe("diffToCsv", () => {
  it("splits lines into before and after by type", () => {
    const result = diffToCsv([
      unchanged("id,name", 1),
      removed("1,Al", 2),
      added("1,Bo", 2),
    ]);
    expect(result.before).toEqual([
      ["id", "name"],
      ["1", "Al"],
    ]);
    expect(result.after).toEqual([
      ["id", "name"],
      ["1", "Bo"],
    ]);
    expect(result.beforeLineNumbers).toEqual([1, 2]);
    expect(result.afterLineNumbers).toEqual([1, 2]);
  });

  it("puts an added-only file entirely on the after side", () => {
    const result = diffToCsv([added("id,name", 1), added("1,Al", 2)]);
    expect(result.before).toEqual([]);
    expect(result.beforeLineNumbers).toEqual([]);
    expect(result.after).toEqual([
      ["id", "name"],
      ["1", "Al"],
    ]);
    expect(result.afterLineNumbers).toEqual([1, 2]);
    expect(result.alignment.map((a) => a.type)).toEqual(["added", "added"]);
  });

  it("puts a removed-only file entirely on the before side", () => {
    const result = diffToCsv([removed("id,name", 1), removed("1,Al", 2)]);
    expect(result.before).toEqual([
      ["id", "name"],
      ["1", "Al"],
    ]);
    expect(result.beforeLineNumbers).toEqual([1, 2]);
    expect(result.after).toEqual([]);
    expect(result.afterLineNumbers).toEqual([]);
    expect(result.alignment.map((a) => a.type)).toEqual(["removed", "removed"]);
  });

  it("emits one alignment entry per input line in order with its numbers", () => {
    const result = diffToCsv([
      unchanged("a,b", 1),
      removed("c,d", 2),
      added("c,e", 2),
    ]);
    expect(result.alignment).toEqual([
      { type: "unchanged", oldLineNumber: 1, newLineNumber: 1 },
      { type: "removed", oldLineNumber: 2, newLineNumber: null },
      { type: "added", oldLineNumber: null, newLineNumber: 2 },
    ]);
  });

  it("keeps original line numbers across non-contiguous hunks", () => {
    const result = diffToCsv([
      unchanged("a,b", 10),
      removed("c,d", 11),
      added("c,e", 11),
      unchanged("x,y", 50, 51),
    ]);
    expect(result.beforeLineNumbers).toEqual([10, 11, 50]);
    expect(result.afterLineNumbers).toEqual([10, 11, 51]);
  });

  it("reassembles a multiline quoted record spanning removed and added lines", () => {
    const result = diffToCsv([
      removed('1,"old', 2),
      removed('text"', 3),
      added('1,"new', 2),
      added('text"', 3),
    ]);
    expect(result.before).toEqual([["1", "old\ntext"]]);
    expect(result.after).toEqual([["1", "new\ntext"]]);
    expect(result.beforeLineNumbers).toEqual([2]);
    expect(result.afterLineNumbers).toEqual([2]);
    expect(result.alignment).toHaveLength(4);
  });

  it("returns a hunk starting inside a quoted record as flagged fragment rows when no file is given (#55)", () => {
    const result = diffToCsv([added('line two"', 12), added("2,x", 13)]);
    expect(result.after).toEqual([['line two"'], ["2", "x"]]);
    expect(result.afterLineNumbers).toEqual([12, 13]);
    expect(result.afterCut).toEqual([true, true]);
  });

  it("replaces a hunk starting inside a quoted record with the complete record when the file is given (#55)", () => {
    const after = ["id,note", '1,"one', 'line two"', "2,x"].join("\n");
    const result = diffToCsv([added('line two"', 3), added("2,x", 4)], {
      after,
    });
    expect(result.after).toEqual([
      ["1", "one\nline two"],
      ["2", "x"],
    ]);
    expect(result.afterLineNumbers).toEqual([3, 4]);
    expect(result.afterCut).toEqual([false, false]);
  });

  it("parses each hunk as its own segment so an open quote at a hunk end does not swallow the next hunk", () => {
    // #68
    const result = diffToCsv([
      removed('1,"old', 10),
      added('1,"new', 10),
      unchanged("visible", 11),
      unchanged("2,ok", 30),
    ]);
    expect(result.before.at(-1)).toEqual(["2", "ok"]);
    expect(result.after.at(-1)).toEqual(["2", "ok"]);
    expect(result.beforeLineNumbers.at(-1)).toBe(30);
    expect(result.afterLineNumbers.at(-1)).toBe(30);
  });

  it("returns a hunk ending inside a quoted record as flagged fragment rows when no file is given (#68)", () => {
    const result = diffToCsv([
      removed('1,"old', 10),
      added('1,"new', 10),
      unchanged("visible", 11),
      unchanged('tail"', 30),
      unchanged("2,ok", 31),
    ]);
    expect(result.before).toEqual([
      ["1", "old\nvisible"],
      ['tail"'],
      ["2", "ok"],
    ]);
    expect(result.after).toEqual([
      ["1", "new\nvisible"],
      ['tail"'],
      ["2", "ok"],
    ]);
    expect(result.beforeLineNumbers).toEqual([10, 30, 31]);
    expect(result.afterLineNumbers).toEqual([10, 30, 31]);
    expect(result.beforeCut).toEqual([true, true, true]);
    expect(result.afterCut).toEqual([true, true, true]);
  });

  it("replaces a hunk ending inside a quoted record with the complete record when the file is given (#68)", () => {
    const before = [
      ...Array(9).fill("x,y"),
      '1,"old',
      "visible",
      'more"',
      "2,ok",
    ].join("\n");
    const after = [
      ...Array(9).fill("x,y"),
      '1,"new',
      "visible",
      'more"',
      "2,ok",
    ].join("\n");
    const result = diffToCsv(
      [removed('1,"old', 10), added('1,"new', 10), unchanged("visible", 11)],
      { before, after },
    );
    expect(result.before).toEqual([["1", "old\nvisible\nmore"]]);
    expect(result.after).toEqual([["1", "new\nvisible\nmore"]]);
    expect(result.beforeLineNumbers).toEqual([10]);
    expect(result.afterLineNumbers).toEqual([10]);
    expect(result.beforeCut).toEqual([false]);
    expect(result.afterCut).toEqual([false]);
  });
});

describe("hunk entries", () => {
  const hunk: HunkEntry = {
    type: "hunk",
    expanders: [
      {
        direction: "down",
        label: "Expand file down from line 3",
        element: document.createElement("button"),
      },
    ],
  };

  it("getFirstLineNumbers ignores a leading hunk entry", () => {
    expect(getFirstLineNumbers([hunk, unchanged("a,b", 24)])).toEqual({
      firstBeforeLine: 24,
      firstAfterLine: 24,
    });
  });

  it("diffToCsv keeps the hunk out of before/after and passes it through alignment", () => {
    const diff = diffToCsv([unchanged("a,b", 1), hunk, unchanged("c,d", 9)]);
    expect(diff.before).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(diff.after).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(diff.beforeLineNumbers).toEqual([1, 9]);
    expect(diff.alignment).toHaveLength(3);
    expect(diff.alignment[1]).toEqual({
      type: "hunk",
      expanders: hunk.expanders,
    });
  });
});
