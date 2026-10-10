import type { Change } from "diff";
import { describe, expect, it } from "vitest";
import { computeInlineDiff } from "./inlineDiff";

const joined = (changes: Change[]) => ({
  removed: changes
    .filter((c) => c.removed)
    .map((c) => c.value)
    .join(""),
  added: changes
    .filter((c) => c.added)
    .map((c) => c.value)
    .join(""),
  before: changes
    .filter((c) => !c.added)
    .map((c) => c.value)
    .join(""),
  after: changes
    .filter((c) => !c.removed)
    .map((c) => c.value)
    .join(""),
});

describe("computeInlineDiff", () => {
  it.each([
    ["before", "", "x"],
    ["after", "x", ""],
    ["both", "", ""],
  ])("returns null when %s is empty", (_side, before, after) => {
    expect(computeInlineDiff(before, after)).toBeNull();
  });

  it("returns word-level changes for a small word edit", () => {
    const changes = computeInlineDiff("hello brave world", "hello new world");
    expect(changes).not.toBeNull();
    expect(joined(changes!)).toEqual({
      removed: "brave",
      added: "new",
      before: "hello brave world",
      after: "hello new world",
    });
  });

  it("falls back to character-level changes for a single-token value", () => {
    const changes = computeInlineDiff("abcdefghij", "abcdefghix");
    expect(changes).not.toBeNull();
    expect(joined(changes!)).toEqual({
      removed: "j",
      added: "x",
      before: "abcdefghij",
      after: "abcdefghix",
    });
  });

  it("returns null when the values are almost entirely different", () => {
    expect(computeInlineDiff("abcdef", "uvwxyz")).toBeNull();
  });

  it("returns changes without additions or removals for identical values", () => {
    const changes = computeInlineDiff("same value", "same value");
    expect(changes).not.toBeNull();
    expect(joined(changes!)).toEqual({
      removed: "",
      added: "",
      before: "same value",
      after: "same value",
    });
  });
});
