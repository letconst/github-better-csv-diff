/**
 * Fetches a whole file from GitHub's raw endpoint, used to rebuild quoted CSV
 * records that a collapsed diff region cut in half.
 *
 * Cache uses Promises to deduplicate concurrent requests; failed results (null)
 * are evicted so later calls can retry.
 */

import { rawFileUrl } from "./rawUrl";

const MAX_BYTES = 5 * 1024 * 1024;

const cache = new Map<string, Promise<string | null>>();

/** Clear the entire cache (call on SPA navigation). */
export function clearFileCache(): void {
  cache.clear();
}

export function fetchFileText(
  owner: string,
  repo: string,
  ref: string,
  filepath: string,
): Promise<string | null> {
  const key = JSON.stringify([owner, repo, ref, filepath]);

  const existing = cache.get(key);
  if (existing) return existing;

  const promise: Promise<string | null> = doFetch(
    owner,
    repo,
    ref,
    filepath,
  ).then((result) => {
    // Only evict our own entry: a clear + refetch may have replaced it.
    if (result === null && cache.get(key) === promise) cache.delete(key);
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
): Promise<string | null> {
  const url = rawFileUrl(owner, repo, ref, filepath);

  try {
    const resp = await fetch(url);

    if (!resp.ok) {
      console.warn(
        `[GitHub Better CSV Diff] File fetch failed: ${resp.status} for ${filepath}`,
      );
      return null;
    }

    const length = Number(resp.headers.get("Content-Length"));
    if (length > MAX_BYTES) {
      await resp.body?.cancel();
      console.warn(
        `[GitHub Better CSV Diff] File too large (>${MAX_BYTES} bytes): ${filepath}`,
      );
      return null;
    }

    return await resp.text();
  } catch (error) {
    console.warn("[GitHub Better CSV Diff] File fetch error:", filepath, error);
    return null;
  }
}
