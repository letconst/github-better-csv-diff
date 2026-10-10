import { describe, expect, it } from "vitest";
import { isDiffRoute, parseDiffRoute } from "./routes";

const sha7 = "abc1234";
const sha40 = "0123456789abcdef0123456789abcdef01234567";

describe("parseDiffRoute", () => {
  it.each([
    ["/owner/repo/pull/123/files", { kind: "pr-files" }],
    ["/owner/repo/pull/123/changes", { kind: "pr-changes" }],
    ["/owner/repo/pull/123/changes/abc1234", { kind: "pr-commit", sha: sha7 }],
    ["/owner/repo/pull/123/commits/abc1234", { kind: "pr-commit", sha: sha7 }],
    ["/owner/repo/commit/abc1234", { kind: "commit", sha: sha7 }],
    [
      "/owner/repo/compare/main...feat",
      { kind: "compare", spec: "main...feat" },
    ],
  ])("matches %s", (path, expected) => {
    expect(parseDiffRoute(path)).toEqual(expected);
  });

  it.each(["/owner/repo/pull/123", "/owner/repo/issues", "/owner/repo", "/"])(
    "does not match %s",
    (path) => {
      expect(parseDiffRoute(path)).toBeNull();
    },
  );

  it.each([
    ["/owner/repo/pull/123/files/", { kind: "pr-files" }],
    ["/owner/repo/pull/123/changes/", { kind: "pr-changes" }],
    ["/owner/repo/pull/123/commits/abc1234/", { kind: "pr-commit", sha: sha7 }],
    ["/owner/repo/commit/abc1234/", { kind: "commit", sha: sha7 }],
  ])("accepts a trailing slash on %s", (path, expected) => {
    expect(parseDiffRoute(path)).toEqual(expected);
  });

  it.each([
    ["/Owner/Repo/PULL/1/FILES", { kind: "pr-files" }],
    ["/o/r/pull/1/Changes", { kind: "pr-changes" }],
    ["/o/r/COMMIT/ABC1234", { kind: "commit", sha: "ABC1234" }],
  ])("matches case-insensitively: %s", (path, expected) => {
    expect(parseDiffRoute(path)).toEqual(expected);
  });

  it.each([
    [sha7, true],
    [sha40, true],
    ["abc123", false],
    [`${sha40}0`, false],
    ["abc123g", false],
  ])("commit sha %s: accepted=%s", (sha, accepted) => {
    expect(parseDiffRoute(`/o/r/commit/${sha}`)).toEqual(
      accepted ? { kind: "commit", sha } : null,
    );
    expect(parseDiffRoute(`/o/r/pull/1/commits/${sha}`)).toEqual(
      accepted ? { kind: "pr-commit", sha } : null,
    );
  });

  it("does not treat /pull/N/files/<sha> as a diff route", () => {
    expect(parseDiffRoute("/o/r/pull/1/files/abc1234")).toBeNull();
  });
});

describe("isDiffRoute", () => {
  it.each([
    ["/o/r/pull/1/files", true],
    ["/o/r/commit/abc1234", true],
    ["/o/r/compare/a...b", true],
    ["/o/r/pull/1", false],
    ["/o/r", false],
  ])("%s -> %s", (path, expected) => {
    expect(isDiffRoute(path)).toBe(expected);
  });
});
