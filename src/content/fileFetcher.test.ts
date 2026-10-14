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
import { clearFileCache, fetchFileText } from "./fileFetcher";

const fetchMock = vi.fn();

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
  clearFileCache();
  vi.restoreAllMocks();
});

describe("fetchFileText", () => {
  it("requests the encoded raw URL without a Range header and returns the body", async () => {
    fetchMock.mockResolvedValue(new Response("a,b\n1,2\n"));
    const text = await fetchFileText("o", "r", "main", "dir/a #1.csv");
    expect(text).toBe("a,b\n1,2\n");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://github.com/o/r/raw/main/dir/a%20%231.csv",
    );
    expect(fetchMock.mock.calls[0]![1]?.headers?.Range).toBeUndefined();
  });

  it("shares one request between concurrent callers and caches the result", async () => {
    fetchMock.mockResolvedValue(new Response("x"));
    const [a, b] = await Promise.all([
      fetchFileText("o", "r", "m", "f.csv"),
      fetchFileText("o", "r", "m", "f.csv"),
    ]);
    expect(a).toBe("x");
    expect(b).toBe("x");
    await fetchFileText("o", "r", "m", "f.csv");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts a null result so a retry refetches", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("ok"));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null with a warning on a non-OK status", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns null with a warning on a network rejection", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns null with a warning when the body exceeds 5 MiB without Content-Length", async () => {
    fetchMock.mockResolvedValue(new Response("a".repeat(5 * 1024 * 1024 + 1)));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("returns a body of exactly 5 MiB", async () => {
    const body = "a".repeat(5 * 1024 * 1024);
    fetchMock.mockResolvedValue(new Response(body));
    expect(await fetchFileText("o", "r", "m", "f.csv")).toBe(body);
  });

  it("refetches after clearFileCache", async () => {
    fetchMock.mockImplementation(async () => new Response("x"));
    await fetchFileText("o", "r", "m", "f.csv");
    clearFileCache();
    await fetchFileText("o", "r", "m", "f.csv");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchFileText cache eviction", () => {
  it("keeps a newer cached request when an older one fails after clearFileCache", async () => {
    let settleOld!: (r: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settleOld = resolve;
        }),
    );
    const old = fetchFileText("o", "r", "m", "f.csv");
    clearFileCache();
    fetchMock.mockResolvedValueOnce(new Response("fresh"));
    const fresh = fetchFileText("o", "r", "m", "f.csv");
    settleOld(new Response("", { status: 500 }));
    expect(await old).toBeNull();
    expect(await fresh).toBe("fresh");
    await fetchFileText("o", "r", "m", "f.csv");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
