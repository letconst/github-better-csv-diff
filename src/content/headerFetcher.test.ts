// @vitest-environment happy-dom
import type { Window as HappyWindow } from "happy-dom";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { clearHeaderCache, fetchCsvHeaderRow } from "./headerFetcher";

const fetchMock = vi.fn();

const partial = (body: string) => new Response(body, { status: 206 });
const rangeOf = (call: number): string =>
  fetchMock.mock.calls[call]![1].headers.Range;

function serveFile(file: string): void {
  fetchMock.mockImplementation(async (_url, init) => {
    const end = Number(/bytes=0-([0-9]+)/.exec(init.headers.Range)![1]);
    return partial(file.slice(0, end + 1));
  });
}

(window as unknown as HappyWindow).happyDOM.setURL("https://github.com/x");
vi.stubGlobal("fetch", fetchMock);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  clearHeaderCache();
  vi.restoreAllMocks();
});

describe("fetchCsvHeaderRow", () => {
  it("requests the encoded raw URL with a 4096-byte Range", async () => {
    fetchMock.mockResolvedValue(partial("a,b\n1,2\n"));
    await fetchCsvHeaderRow("o", "r", "main", "dir/a #1.csv");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://github.com/o/r/raw/main/dir/a%20%231.csv",
    );
    expect(rangeOf(0)).toBe("bytes=0-4095");
  });

  it("parses a complete first line with one fetch", async () => {
    fetchMock.mockResolvedValue(partial('id,"a,b",c\n1,2,3\n'));
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toEqual([
      "id",
      "a,b",
      "c",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doubles the range until the first record completes", async () => {
    const longField = `line one\n${"x".repeat(5000)}\nlast`;
    serveFile(`id,"${longField}",tail\nrow2,a,b\n`);
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toEqual([
      "id",
      longField,
      "tail",
    ]);
    expect([rangeOf(0), rangeOf(1)]).toEqual(["bytes=0-4095", "bytes=0-8191"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses escaped quotes and embedded newlines in the first record", async () => {
    serveFile('"say ""hi""","a\nb",c\nrow2,x,y\n');
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toEqual([
      'say "hi"',
      "a\nb",
      "c",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a 200 body without newline as the single row", async () => {
    fetchMock.mockResolvedValue(new Response("a,b,c", { status: 200 }));
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 5 attempts (4096..65536) with a warning", async () => {
    serveFile(`id,"${"x".repeat(70000)}\n`);
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(rangeOf(4)).toBe("bytes=0-65535");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null with a warning on HTTP 404", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null with a warning on network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null with a warning when Papa reports a parse error", async () => {
    // A closing quote followed by text is an InvalidQuotes error
    fetchMock.mockResolvedValue(partial('a,"b"c,d\n1,2,3\n'));
    expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  describe("cache", () => {
    it("dedups concurrent calls but not different refs", async () => {
      fetchMock.mockImplementation(async () => partial("a,b\n"));
      const p1 = fetchCsvHeaderRow("o", "r", "m", "f.csv");
      const p2 = fetchCsvHeaderRow("o", "r", "m", "f.csv");
      const other = fetchCsvHeaderRow("o", "r", "other", "f.csv");
      const [r1, r2] = await Promise.all([p1, p2, other]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(r1).toBe(r2);
    });

    it("evicts null results so a later call refetches", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
      fetchMock.mockResolvedValueOnce(partial("a,b\n"));
      expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toBeNull();
      expect(await fetchCsvHeaderRow("o", "r", "m", "f.csv")).toEqual([
        "a",
        "b",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("caches successes until clearHeaderCache", async () => {
      fetchMock.mockImplementation(async () => partial("a,b\n"));
      await fetchCsvHeaderRow("o", "r", "m", "f.csv");
      await fetchCsvHeaderRow("o", "r", "m", "f.csv");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clearHeaderCache();
      await fetchCsvHeaderRow("o", "r", "m", "f.csv");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
