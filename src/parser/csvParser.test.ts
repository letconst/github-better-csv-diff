import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsvWithLineMap } from "./csvParser";

afterEach(() => vi.restoreAllMocks());

describe("parseCsvWithLineMap", () => {
  it("returns empty data for empty input", () => {
    expect(parseCsvWithLineMap([], [])).toEqual({
      data: [],
      lineNumbers: [],
      cut: [],
    });
  });

  it("parses a header-only input as one row", () => {
    expect(parseCsvWithLineMap(["a,b"], [5])).toEqual({
      data: [["a", "b"]],
      lineNumbers: [5],
      cut: [false],
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
      cut: [false, false, false],
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
      cut: [false, false],
    });
  });

  it("returns no rows for blank-only input", () => {
    expect(parseCsvWithLineMap(["", ""], [1, 2])).toEqual({
      data: [],
      lineNumbers: [],
      cut: [],
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

  it("treats a null line number as one physical line and does not split there", () => {
    const result = parseCsvWithLineMap(
      ['1,"a', "b", 'c"', "2,x"],
      [10, null, 12, 13],
    );
    expect(result).toEqual({
      data: [
        ["1", "a\nb\nc"],
        ["2", "x"],
      ],
      lineNumbers: [10, 13],
      cut: [false, false],
    });
  });

  it("shares one delimiter across segments instead of guessing per segment", () => {
    const result = parseCsvWithLineMap(
      ["id,note", "1,ok", "2,a;b;c"],
      [1, 2, 20],
    );
    expect(result).toEqual({
      data: [
        ["id", "note"],
        ["1", "ok"],
        ["2", "a;b;c"],
      ],
      lineNumbers: [1, 2, 20],
      cut: [false, false, false],
    });
  });

  it("takes the delimiter from a later segment when an earlier one ends inside an open quote", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseCsvWithLineMap(['"open', "2;ok", "3;x"], [1, 20, 21]);
    expect(result.data.slice(1)).toEqual([
      ["2", "ok"],
      ["3", "x"],
    ]);
    expect(result.lineNumbers).toEqual([1, 20, 21]);
    warn.mockRestore();
  });

  it("still warns when no delimiter can be detected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseCsvWithLineMap(["plain", "text"], [1, 2]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain(
      "UndetectableDelimiter",
    );
    warn.mockRestore();
  });

  it("warns about an unterminated quote and still returns the parsed rows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseCsvWithLineMap(['a,"b', "c,d"], [1, 2]);
    expect(warn).toHaveBeenCalled();
    expect(result).toEqual({
      data: [["a", "b\nc,d"]],
      lineNumbers: [1],
      cut: [true],
    });
  });
});

const warningsContaining = (
  warn: { mock: { calls: unknown[][] } },
  text: string,
) => warn.mock.calls.filter((call) => String(call[0]).includes(text));

describe("parseCsvWithLineMap cut records", () => {
  const file = [
    "id,note",
    "1,ok",
    '2,"first',
    "second",
    'third"',
    "3,after",
  ].join("\n");

  it("flags a segment starting inside a quoted record as cut", () => {
    const result = parseCsvWithLineMap(['third"', "3,after"], [5, 6]);
    expect(result.cut).toEqual([true, true]);
  });

  it("flags a segment ending inside a quoted record as cut", () => {
    const result = parseCsvWithLineMap(["1,ok", '2,"first'], [2, 3]);
    expect(result.cut).toEqual([true, true]);
  });

  it("does not flag a segment with balanced quotes", () => {
    const result = parseCsvWithLineMap(['1,"a ""b"""', "2,x"], [1, 2]);
    expect(result.cut).toEqual([false, false]);
  });

  it("flags only the cut segment among several", () => {
    const result = parseCsvWithLineMap(
      ["1,ok", 'third"', "3,after"],
      [2, 5, 6],
    );
    expect(result.cut).toEqual([false, true, true]);
  });

  it("replaces a start-cut segment with the full record clamped to the segment start", () => {
    const result = parseCsvWithLineMap(['third"', "3,after"], [5, 6], file);
    expect(result.data).toEqual([
      ["2", "first\nsecond\nthird"],
      ["3", "after"],
    ]);
    expect(result.lineNumbers).toEqual([5, 6]);
    expect(result.cut).toEqual([false, false]);
  });

  it("replaces an end-cut segment with the full record running past the segment end", () => {
    const result = parseCsvWithLineMap(["1,ok", '2,"first'], [2, 3], file);
    expect(result.data).toEqual([
      ["1", "ok"],
      ["2", "first\nsecond\nthird"],
    ]);
    expect(result.lineNumbers).toEqual([2, 3]);
    expect(result.cut).toEqual([false, false]);
  });

  it("keeps the fragment and its cut flags when the file does not match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseCsvWithLineMap(
      ['third"', "3,after"],
      [5, 6],
      file.replace("3,after", "3,changed"),
    );
    expect(result.data).toEqual([['third"'], ["3", "after"]]);
    expect(result.cut).toEqual([true, true]);
    expect(warningsContaining(warn, "does not match")).toHaveLength(1);
  });

  it("warns once even when several segments mismatch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseCsvWithLineMap(['x"', 'y"'], [100, 200], file);
    expect(warningsContaining(warn, "does not match")).toHaveLength(1);
  });

  it("leaves a segment without quotes alone when a file is given", () => {
    const result = parseCsvWithLineMap(["1,ok"], [2], file);
    expect(result.data).toEqual([["1", "ok"]]);
    expect(result.cut).toEqual([false]);
  });

  it("keeps rows that were already complete inside the cut segment", () => {
    const result = parseCsvWithLineMap(
      ["1,ok", '2,"first', "second"],
      [2, 3, 4],
      file,
    );
    expect(result.data).toEqual([
      ["1", "ok"],
      ["2", "first\nsecond\nthird"],
    ]);
    expect(result.lineNumbers).toEqual([2, 3]);
    expect(result.cut).toEqual([false, false]);
  });

  it("reports parse errors of the fetched file", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseCsvWithLineMap(
      ["1,ok", '2,"first'],
      [2, 3],
      file.replace('third"', "third"),
    );
    expect(warningsContaining(warn, "parse errors")).toHaveLength(1);
  });

  it("yields \n inside the rebuilt field from a CRLF file", () => {
    const result = parseCsvWithLineMap(
      ['third"', "3,after"],
      [5, 6],
      file.replaceAll("\n", "\r\n"),
    );
    expect(result.data[0]).toEqual(["2", "first\nsecond\nthird"]);
  });

  it("reconstructs the last record of a file without a trailing newline", () => {
    const text = ["id,note", '1,"a', 'b"'].join("\n");
    const result = parseCsvWithLineMap(['b"'], [3], text);
    expect(result.data).toEqual([["1", "a\nb"]]);
    expect(result.lineNumbers).toEqual([3]);
    expect(result.cut).toEqual([false]);
  });

  it("reconstructs a record when the file ends with a newline", () => {
    const result = parseCsvWithLineMap(['b"'], [3], 'id,note\n1,"a\nb"\n');
    expect(result.data).toEqual([["1", "a\nb"]]);
  });

  it("never reconstructs a segment whose lines are all unnumbered", () => {
    const result = parseCsvWithLineMap(['third"'], [null], file);
    expect(result.data).toEqual([['third"']]);
    expect(result.cut).toEqual([true]);
  });

  it("uses the delimiter detected from an intact segment for the file parse", () => {
    const text = ["id;note", "1;ok", '2;"a;b', 'c"', "3;x"].join("\n");
    const result = parseCsvWithLineMap(
      ["id;note", "1;ok", 'c"', "3;x"],
      [1, 2, 4, 5],
      text,
    );
    expect(result.data).toEqual([
      ["id", "note"],
      ["1", "ok"],
      ["2", "a;b\nc"],
      ["3", "x"],
    ]);
  });
});

describe("parseCsvWithLineMap cut records across hunks and delimiters", () => {
  it("takes the delimiter from the fetched file when no visible segment can detect it", () => {
    const text = ["id\tnote", '2\t"first', 'second"', "3\tx"].join("\n");
    const result = parseCsvWithLineMap(['second"', "3\tx"], [3, 4], text);
    expect(result.data).toEqual([
      ["2", "first\nsecond"],
      ["3", "x"],
    ]);
    expect(result.lineNumbers).toEqual([3, 4]);
    expect(result.cut).toEqual([false, false]);
  });

});
