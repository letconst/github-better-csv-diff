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

    const text = await readTextWithinCap(resp);
    if (text === null) {
      console.warn(
        `[GitHub Better CSV Diff] File too large (>${MAX_BYTES} bytes): ${filepath}`,
      );
    }
    return text;
  } catch (error) {
    console.warn("[GitHub Better CSV Diff] File fetch error:", filepath, error);
    return null;
  }
}

async function readTextWithinCap(resp: Response): Promise<string | null> {
  if (!resp.body) return resp.text();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
