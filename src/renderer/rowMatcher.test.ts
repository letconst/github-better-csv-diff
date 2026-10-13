import { describe, expect, it } from "vitest";
import type { DiffAlignment } from "../parser/diffParser";
import { type MatchedRow, matchRows } from "./rowMatcher";

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

const row = (
  type: MatchedRow["type"],
  before: string[] | null,
  after: string[] | null,
  beforeLineNumber: number | null,
  afterLineNumber: number | null,
): MatchedRow => ({ type, before, after, beforeLineNumber, afterLineNumber });

const A = ["A", "1"];
const B = ["B", "2"];
const C = ["C", "3"];
const B9 = ["B", "9"];
const A2 = ["A", "2"];
const A3 = ["A", "3"];

describe("matchRows alignment", () => {
  it("emits a moved row as removed at the old place and added at the new place, in diff order", () => {
    const after = [B, C, A];
    const rows = matchRows(
      [A, B, C],
      after,
      [2, 3, 4],
      [2, 3, 4],
      [gone(2), same(3, 2), same(4, 3), came(4)],
    );
    expect(rows).toEqual([
      row("removed", A, null, 2, null),
      row("unchanged", B, B, 3, 2),
      row("unchanged", C, C, 4, 3),
      row("added", null, A, null, 4),
    ]);
  });

  it("pairs a lone removed/added as modified even when the key differs", () => {
    expect(matchRows([A], [["Z", "9"]], [2], [2], [gone(2), came(2)])).toEqual([
      row("modified", A, ["Z", "9"], 2, 2),
    ]);
  });

  it("reports an aligned modified pair with identical content as unchanged", () => {
    expect(matchRows([A], [A], [2], [2], [gone(2), came(2)])).toEqual([
      row("unchanged", A, A, 2, 2),
    ]);
  });

  it("reports an aligned unchanged pair with different content as modified", () => {
    const edited = ["A", "9"];
    expect(matchRows([A], [edited], [2], [2], [same(2, 2)])).toEqual([
      row("modified", A, edited, 2, 2),
    ]);
  });
});

describe("matchRows multiline continuation", () => {
  it("ignores continuation-line alignment entries and still consumes every logical row", () => {
    const added = ["k", "new"];
    const lead = ["k", "0"];
    const before = [lead, ["k", "a\nb"]];
    const after = [added, lead, ["k", "a\nc"]];
    const rows = matchRows(
      before,
      after,
      [2, 3],
      [2, 3, 4],
      [came(2), same(2, 3), same(3, 4), gone(4), came(5)],
    );
    expect(rows).toEqual([
      row("added", null, added, null, 2),
      row("unchanged", lead, lead, 2, 3),
      row("modified", before[1]!, after[2]!, 3, 4),
    ]);
  });
});

describe("matchRows alignment fallback", () => {
  it("falls back to key matching when alignment leaves rows unconsumed and keys are unique", () => {
    const k1 = ["k1", "1"];
    const k2 = ["k2", "2"];
    const k3 = ["k3", "3"];
    expect(
      matchRows([k1, k2, k3], [k3, k1, k2], [2, 3, 4], [2, 3, 4], [same(2, 2)]),
    ).toEqual([
      row("unchanged", k1, k1, 2, 3),
      row("unchanged", k2, k2, 3, 4),
      row("unchanged", k3, k3, 4, 2),
    ]);
  });

  it("falls back to order matching when keys are duplicated", () => {
    const dupBefore = [A, A2];
    const dupAfter = [A, A3];
    const rows = matchRows(dupBefore, dupAfter, [2, 3], [2, 3], [same(2, 2)]);
    expect(rows).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", dupBefore[1]!, dupAfter[1]!, 3, 3),
    ]);
  });

  it.each([
    ["undefined", undefined],
    ["empty", []],
  ])("matches by key when alignment is %s", (_name, alignment) => {
    const before = [A, B];
    const after = [A, B9];
    expect(matchRows(before, after, [2, 3], [2, 3], alignment)).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", B, after[1]!, 3, 3),
    ]);
  });
});

describe("matchRows block pairing", () => {
  const edited = [["A", "10"], B9, ["C", "30"]];
  const blockAlignment = [
    gone(2),
    gone(3),
    gone(4),
    came(2),
    came(3),
    came(4),
    came(5),
  ];

  it("pairs monotonic key matches inside a larger block", () => {
    expect(
      matchRows(
        [A, B, C],
        edited,
        [2, 3, 4],
        [2, 3, 4],
        [gone(2), gone(3), gone(4), came(2), came(3), came(4)],
      ),
    ).toEqual([
      row("modified", A, edited[0]!, 2, 2),
      row("modified", B, edited[1]!, 3, 3),
      row("modified", C, edited[2]!, 4, 4),
    ]);
  });

  it("emits an unmatched added row inside the block with before null", () => {
    const n = ["N", "5"];
    const after = [edited[0]!, n, edited[1]!, edited[2]!];
    expect(
      matchRows([A, B, C], after, [2, 3, 4], [2, 3, 4, 5], blockAlignment),
    ).toEqual([
      row("modified", A, after[0]!, 2, 2),
      row("added", null, n, null, 3),
      row("modified", B, after[2]!, 3, 4),
      row("modified", C, after[3]!, 4, 5),
    ]);
  });

  it("keeps diff order (all removed, then all added) when keys cross", () => {
    const after = [C, B, A];
    expect(
      matchRows(
        [A, B, C],
        after,
        [2, 3, 4],
        [2, 3, 4],
        [gone(2), gone(3), gone(4), came(2), came(3), came(4)],
      ),
    ).toEqual([
      row("removed", A, null, 2, null),
      row("removed", B, null, 3, null),
      row("removed", C, null, 4, null),
      row("added", null, C, null, 2),
      row("added", null, B, null, 3),
      row("added", null, A, null, 4),
    ]);
  });

  it.each([
    ["an empty key", [["", "1"], B], [["", "1"], B9]],
    ["a duplicated key", [A, A2], [A, ["B", "2"]]],
  ])("does not pair a block with %s", (_name, before, after) => {
    expect(
      matchRows(
        before,
        after,
        [2, 3],
        [2, 3],
        [gone(2), gone(3), came(2), came(3)],
      ),
    ).toEqual([
      row("removed", before[0]!, null, 2, null),
      row("removed", before[1]!, null, 3, null),
      row("added", null, after[0]!, null, 2),
      row("added", null, after[1]!, null, 3),
    ]);
  });
});

describe("matchRows without alignment", () => {
  it("pairs unique keys by key, with unmatched keys as added/removed", () => {
    const D = ["D", "4"];
    const before = [A, B, C];
    const after = [C, A, D];
    const rows = matchRows(before, after, [2, 3, 4], [2, 3, 4], []);
    expect(rows).toEqual([
      row("unchanged", A, A, 2, 3),
      row("removed", B, null, 3, null),
      row("unchanged", C, C, 4, 2),
      row("added", null, D, null, 4),
    ]);
  });

  it("pairs duplicate keys by index", () => {
    const rows = matchRows([A, A2], [A, A3, ["A", "4"]], [2, 3], [2, 3, 4], []);
    expect(rows).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", A2, A3, 3, 3),
      row("added", null, ["A", "4"], null, 4),
    ]);
  });

  it("returns no rows when both sides are empty", () => {
    expect(matchRows([], [], [], [], [])).toEqual([]);
  });
});

describe("matchRows line numbers", () => {
  it("reports null for a row whose line number is null (key path)", () => {
    expect(matchRows([A, B], [A, B9], [2, null], [2, 3], [])).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", B, B9, null, 3),
    ]);
  });

  it("reports null for a row whose line number is null (order path)", () => {
    expect(matchRows([A, A2], [A, A3], [2, null], [2, 3], [])).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", A2, A3, null, 3),
    ]);
  });

  it("falls back from alignment when a row has a null line number and cannot be resolved", () => {
    expect(
      matchRows([A, B], [A, B9], [2, null], [2, 3], [same(2, 2), same(3, 3)]),
    ).toEqual([row("unchanged", A, A, 2, 2), row("modified", B, B9, null, 3)]);
  });

  it("characterization: missing line number array elements give null (key path)", () => {
    expect(matchRows([A, B], [A, B9], [2], [2], [])).toEqual([
      row("unchanged", A, A, 2, 2),
      row("modified", B, B9, null, null),
    ]);
  });

  it("characterization: missing line number array elements give null (order path)", () => {
    expect(matchRows([A, A2], [A], [2], [], [])).toEqual([
      row("unchanged", A, A, 2, null),
      row("removed", A2, null, null, null),
    ]);
  });
});
