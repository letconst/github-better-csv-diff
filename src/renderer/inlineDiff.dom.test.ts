// @vitest-environment happy-dom
import type { Change } from "diff";
import { describe, expect, it } from "vitest";
import {
  appendTextWithBreaks,
  renderInlineAfter,
  renderInlineBefore,
} from "./inlineDiff";

const same = (value: string): Change => ({
  value,
  count: 1,
  added: false,
  removed: false,
});
const del = (value: string): Change => ({
  value,
  count: 1,
  added: false,
  removed: true,
});
const ins = (value: string): Change => ({
  value,
  count: 1,
  added: true,
  removed: false,
});

const changes = [same("hello "), del("brave"), ins("new"), same(" world")];

const texts = (el: HTMLElement, selector: string) =>
  [...el.querySelectorAll(selector)].map((n) => n.textContent);

describe("renderInlineBefore", () => {
  it("keeps the before text and wraps only removed segments", () => {
    const el = document.createElement("div");
    el.append(renderInlineBefore(changes));
    expect(el.textContent).toBe("hello brave world");
    expect(texts(el, ".csv-diff-inline-removed")).toEqual(["brave"]);
    expect(el.querySelector(".csv-diff-inline-added")).toBeNull();
  });

  it("highlights each line of a removed multi-line segment, with indicator and <br> outside the spans", () => {
    const el = document.createElement("div");
    el.append(renderInlineBefore([same("x"), del("a\nb")]));
    expect(
      texts(el, ".csv-diff-inline-removed:not(.csv-diff-newline-indicator)"),
    ).toEqual(["a", "b"]);
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.querySelectorAll(".csv-diff-newline-indicator")).toHaveLength(1);
    expect(el.querySelector("span.csv-diff-inline-removed br")).toBeNull();
  });
});

describe("renderInlineAfter", () => {
  it("keeps the after text and wraps only added segments", () => {
    const el = document.createElement("div");
    el.append(renderInlineAfter(changes));
    expect(el.textContent).toBe("hello new world");
    expect(texts(el, ".csv-diff-inline-added")).toEqual(["new"]);
    expect(el.querySelector(".csv-diff-inline-removed")).toBeNull();
  });

  it("renders a newline inside an unchanged segment as indicator + <br>", () => {
    const el = document.createElement("div");
    el.append(renderInlineAfter([same("a\nb"), ins("c")]));
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.querySelectorAll(".csv-diff-newline-indicator")).toHaveLength(1);
    expect(texts(el, ".csv-diff-inline-added")).toEqual(["c"]);
  });
});

describe("appendTextWithBreaks", () => {
  it("appends plain text unchanged when there is no newline", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "abc", true);
    expect(el.textContent).toBe("abc");
    expect(el.querySelector("br")).toBeNull();
    expect(el.querySelector(".csv-diff-newline-indicator")).toBeNull();
  });

  it("inserts one <br> and one indicator per newline", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "a\nb\nc", true);
    expect(el.textContent).toBe("abc");
    expect(el.querySelectorAll("br")).toHaveLength(2);
    expect(el.querySelectorAll(".csv-diff-newline-indicator")).toHaveLength(2);
  });

  it("omits indicators unless requested", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "a\nb");
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.querySelector(".csv-diff-newline-indicator")).toBeNull();
  });

  it("counts CRLF as a single newline", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "a\r\nb", true);
    expect(el.textContent).toBe("ab");
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.querySelectorAll(".csv-diff-newline-indicator")).toHaveLength(1);
  });

  it("keeps empty lines from consecutive newlines", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "a\n\nb", true);
    expect(el.querySelectorAll("br")).toHaveLength(2);
  });

  it("marks indicators aria-hidden so screen readers skip them", () => {
    const el = document.createElement("div");
    appendTextWithBreaks(el, "a\nb", true);
    expect(
      el
        .querySelector(".csv-diff-newline-indicator")!
        .getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
