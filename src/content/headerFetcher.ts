/**
 * Fetches the first CSV row (header) from GitHub's raw file endpoint.
 * Uses Range headers for efficiency and retries with expanding ranges
 * when the first record is truncated.
 *
 * Cache uses Promises (not resolved values) to deduplicate concurrent requests.
 * Failed results (null) are evicted from cache immediately so retries are possible.
 */

import Papa from "papaparse";

const INITIAL_RANGE = 4096;
const MAX_RANGE = 65536;

const cache = new Map<string, Promise<string[] | null>>();

/** Clear the entire cache (call on SPA navigation). */
export function clearHeaderCache(): void {
  cache.clear();
}

/**
 * Fetch the first CSV row for a given file at a specific revision.
 * Returns the parsed header row, or null on failure.
 */
export function fetchCsvHeaderRow(
  owner: string,
  repo: string,
  ref: string,
  filepath: string,
): Promise<string[] | null> {
  const key = JSON.stringify([owner, repo, ref, filepath]);

  const existing = cache.get(key);
  if (existing) return existing;

  const promise = doFetch(owner, repo, ref, filepath).then((result) => {
    // Evict null results so later calls can retry
    if (result === null) {
      cache.delete(key);
    }
    return result;
  });

  cache.set(key, promise);
  return promise;
}

async function doFetch(
  owner: string,
  repo: string,
  ref: string,
  filepath: string,
): Promise<string[] | null> {
  // Encode filepath segments (preserving /) for special chars like #, ?, %
  const encodedPath = filepath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const baseUrl = `/${owner}/${repo}/raw/${ref}/${encodedPath}`;
  let rangeEnd = INITIAL_RANGE;

  while (rangeEnd <= MAX_RANGE) {
    try {
      const resp = await fetch(baseUrl, {
        headers: { Range: `bytes=0-${rangeEnd - 1}` },
      });

      if (!resp.ok && resp.status !== 206) {
        console.warn(
          `[GitHub Better CSV Diff] Header fetch failed: ${resp.status} for ${filepath}`,
        );
        return null;
      }

      const text = await resp.text();
      const firstRecordEnd = findFirstRecordEnd(text);

      if (firstRecordEnd !== -1) {
        // We have a complete first record
        const firstLine = text.substring(0, firstRecordEnd);
        return parseFirstRow(firstLine);
      }

      if (resp.status === 200) {
        // Full file received but no newline — entire file is one row
        return parseFirstRow(text);
      }

      // Partial response (206) and first record is incomplete — expand range
      rangeEnd *= 2;
    } catch (error) {
      console.warn(
        "[GitHub Better CSV Diff] Header fetch error:",
        filepath,
        error,
      );
      return null;
    }
  }

  // Exceeded max range without finding complete first record
  console.warn(
    `[GitHub Better CSV Diff] Header row too large (>${MAX_RANGE} bytes) for ${filepath}`,
  );
  return null;
}

function parseFirstRow(text: string): string[] | null {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    return null;
  }

  return result.data[0] ?? null;
}

/**
 * Find the index of the first unquoted newline in CSV text.
 * Returns -1 if no complete record boundary is found.
 */
function findFirstRecordEnd(text: string): number {
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuote = !inQuote;
    } else if (!inQuote && (ch === "\n" || ch === "\r")) {
      return i;
    }
  }
  return -1;
}
