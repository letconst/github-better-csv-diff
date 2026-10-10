import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsvWithLineMap } from "./csvParser";

afterEach(() => vi.restoreAllMocks());

describe("parseCsvWithLineMap", () => {
  it("returns empty data for empty input", () => {
    expect(parseCsvWithLineMap([], [])).toEqual({ data: [], lineNumbers: [] });
  });

  it("parses a header-only input as one row", () => {
    expect(parseCsvWithLineMap(["a,b"], [5])).toEqual({
      data: [["a", "b"]],
      lineNumbers: [5],
    });
  });

  it("keeps commas and escaped quotes inside quoted fields", () => {
    const { data } = parseCsvWithLineMap(['1,"a,b","say ""hi"""'], [1]);
    expect(data).toEqual([["1", "a,b", 'say "hi"']]);
  });

  it("maps a multiline quoted record to the line where it starts", () => {
    const result = parseCsvWithLineMap(
      ["id,note", '1,"line one', 'line two"', "2,x"],
      [10, 11, 12, 13],
    );
    expect(result).toEqual({
      data: [
        ["id", "note"],
        ["1", "line one\nline two"],
        ["2", "x"],
      ],
      lineNumbers: [10, 11, 13],
    });
  });

  it("strips trailing CR from CRLF lines", () => {
    const { data } = parseCsvWithLineMap(["a,b\r", "c,d\r"], [1, 2]);
    expect(data).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps line numbers aligned when blank lines are skipped", () => {
    const result = parseCsvWithLineMap(["a,b", "", "c,d"], [1, 2, 3]);
    expect(result).toEqual({
      data: [
        ["a", "b"],
        ["c", "d"],
      ],
      lineNumbers: [1, 3],
    });
  });

  it("returns no rows for blank-only input", () => {
    expect(parseCsvWithLineMap(["", ""], [1, 2])).toEqual({
      data: [],
      lineNumbers: [],
    });
  });

  it("auto-detects tab-delimited input", () => {
    const { data } = parseCsvWithLineMap(["a\tb", "1\t2"], [1, 2]);
    expect(data).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves ragged rows as parsed", () => {
    const { data } = parseCsvWithLineMap(
      ["a,b,c", "1,2", "3,4,5,6"],
      [1, 2, 3],
    );
    expect(data).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
      ["3", "4", "5", "6"],
    ]);
  });

  it("passes null line numbers through", () => {
    const result = parseCsvWithLineMap(["a,b", "c,d"], [null, 7]);
    expect(result.lineNumbers).toEqual([null, 7]);
  });

  it("warns about an unterminated quote and still returns the parsed rows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseCsvWithLineMap(['a,"b', "c,d"], [1, 2]);
    expect(warn).toHaveBeenCalled();
    expect(result).toEqual({
      data: [["a", "b\nc,d"]],
      lineNumbers: [1],
    });
  });
});
