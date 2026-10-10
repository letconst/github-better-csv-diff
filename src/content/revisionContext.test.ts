// @vitest-environment happy-dom
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRevisionContextCache,
  getRevisionContext,
} from "./revisionContext";

const SHA = "2076518958";
const PARENT = "783e2cb9b7";

function goTo(path: string): void {
  (window as unknown as HappyWindow).happyDOM.setURL(
    `https://github.com${path}`,
  );
}

function addJson(payload: unknown): void {
  const script = document.createElement("script");
  script.type = "application/json";
  script.textContent =
    typeof payload === "string" ? payload : JSON.stringify({ payload });
  document.body.append(script);
}

const prPayload = (key: string) => ({
  [key]: { comparison: { fullDiff: { baseOid: "b1", headOid: "h1" } } },
});

beforeEach(() => {
  document.body.innerHTML = "";
  clearRevisionContextCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRevisionContext", () => {
  it("returns null refs on a non-diff route", () => {
    goTo("/o/r/pull/1");
    expect(getRevisionContext()).toEqual({
      owner: "o",
      repo: "r",
      baseRef: null,
      headRef: null,
    });
  });

  it("returns null when the path has no owner/repo", () => {
    goTo("/");
    expect(getRevisionContext()).toBeNull();
  });

  describe("pr-changes", () => {
    beforeEach(() => goTo("/o/r/pull/1/changes"));

    it.each(["pullRequestsChangesRoute", "pullRequestsChangesWithRangeRoute"])(
      "reads refs from %s",
      (key) => {
        addJson(prPayload(key));
        expect(getRevisionContext()).toMatchObject({
          baseRef: "b1",
          headRef: "h1",
        });
      },
    );

    it("returns null refs when no JSON carries them", () => {
      addJson({ other: {} });
      expect(getRevisionContext()).toMatchObject({
        baseRef: null,
        headRef: null,
      });
    });

    it("warns on malformed JSON and continues to the next script", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      addJson('{"pullRequestsChangesRoute": oops');
      addJson(prPayload("pullRequestsChangesRoute"));
      expect(getRevisionContext()).toMatchObject({
        baseRef: "b1",
        headRef: "h1",
      });
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("pr-files", () => {
    beforeEach(() => goTo("/o/r/pull/1/files"));

    it("uses end_commit_oid as headRef and leaves baseRef null", () => {
      document.body.innerHTML =
        '<div data-url="/o/r/pull/2/show_partial_comparison?base_commit_oid=96e7fb&end_commit_oid=20765189&partial=pull_requests%2Fstale_comparison&start_commit_oid=96e7fb"></div>';
      expect(getRevisionContext()).toMatchObject({
        baseRef: null,
        headRef: "20765189",
      });
    });

    it("returns null refs without the element", () => {
      expect(getRevisionContext()).toMatchObject({
        baseRef: null,
        headRef: null,
      });
    });
  });

  describe("commit", () => {
    beforeEach(() => goTo(`/o/r/commit/${SHA}`));

    it("falls back to sha^ without embedded JSON", () => {
      expect(getRevisionContext()).toMatchObject({
        baseRef: `${SHA}^`,
        headRef: SHA,
      });
    });

    it("reads the live commitRoute shape", () => {
      addJson({
        commitRoute: { commit: { oid: "full-oid", parents: [PARENT] } },
      });
      expect(getRevisionContext()).toMatchObject({
        baseRef: PARENT,
        headRef: "full-oid",
      });
    });

    it("characterization: reads the legacy shape with object parents", () => {
      addJson({ commit: { oid: "full-oid", parents: [{ oid: PARENT }] } });
      expect(getRevisionContext()).toMatchObject({
        baseRef: PARENT,
        headRef: "full-oid",
      });
    });
  });

  describe("pr-commit", () => {
    beforeEach(() => goTo(`/o/r/pull/1/commits/${SHA}`));

    it("falls back to sha^ with nothing embedded", () => {
      expect(getRevisionContext()).toMatchObject({
        baseRef: `${SHA}^`,
        headRef: SHA,
      });
    });

    it("prefers PR JSON over the sha fallback", () => {
      addJson(prPayload("pullRequestsChangesRoute"));
      expect(getRevisionContext()).toMatchObject({
        baseRef: "b1",
        headRef: "h1",
      });
    });

    it("prefers commit JSON over PR JSON", () => {
      addJson(prPayload("pullRequestsChangesRoute"));
      addJson({ commit: { oid: "c-head", parents: ["c-base"] } });
      expect(getRevisionContext()).toMatchObject({
        baseRef: "c-base",
        headRef: "c-head",
      });
    });
  });

  describe("compare", () => {
    it("splits base...head", () => {
      goTo("/o/r/compare/main...feat");
      expect(getRevisionContext()).toMatchObject({
        baseRef: "main",
        headRef: "feat",
      });
    });

    it("decodes URL-encoded refs", () => {
      goTo("/o/r/compare/main...feat%2Fx");
      expect(getRevisionContext()).toMatchObject({ headRef: "feat/x" });
    });

    it("drops cross-fork refs", () => {
      goTo("/o/r/compare/user:branch...main");
      expect(getRevisionContext()).toMatchObject({
        baseRef: null,
        headRef: "main",
      });
    });

    it("returns null refs without a ... separator", () => {
      goTo("/o/r/compare/main");
      expect(getRevisionContext()).toMatchObject({
        baseRef: null,
        headRef: null,
      });
    });
  });

  describe("cache", () => {
    it("returns the same object for the same pathname despite DOM changes", () => {
      goTo(`/o/r/commit/${SHA}`);
      const first = getRevisionContext();
      addJson({ commit: { oid: "later", parents: ["later-base"] } });
      expect(getRevisionContext()).toBe(first);
    });

    it("re-reads after clearRevisionContextCache", () => {
      goTo(`/o/r/commit/${SHA}`);
      const first = getRevisionContext();
      addJson({ commit: { oid: "later", parents: ["later-base"] } });
      clearRevisionContextCache();
      expect(getRevisionContext()).toMatchObject({ headRef: "later" });
      expect(getRevisionContext()).not.toBe(first);
    });

    it("re-reads for a different pathname", () => {
      goTo("/o/r/compare/a...b");
      const first = getRevisionContext();
      goTo("/o/r/compare/a...c");
      expect(getRevisionContext()).toMatchObject({ headRef: "c" });
      expect(getRevisionContext()).not.toBe(first);
    });
  });
});
