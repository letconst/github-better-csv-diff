/**
 * Extracts base/head revision refs from the current GitHub page DOM.
 * Supports Preview UI, Classic UI, commit diff, compare view, and PR commit pages.
 *
 * Limitations:
 * - Classic UI (/files): baseRef is null because base_commit_oid from
 *   show_partial_comparison is the head's parent commit, not the PR merge base.
 *   The caller should fall back to the after side's header for the before side.
 * - Compare view: refs are branch names from the URL, which may drift if the
 *   branch is updated while viewing. Same-repo compares only.
 */

import { parseDiffRoute } from "./routes";

export interface RevisionContext {
  owner: string;
  repo: string;
  baseRef: string | null;
  headRef: string | null;
}

let cachedContext: RevisionContext | null = null;
let cachedPathname: string | null = null;

/** Get the revision context for the current page. Cached per pathname. */
export function getRevisionContext(): RevisionContext | null {
  if (cachedContext && cachedPathname === location.pathname) {
    return cachedContext;
  }

  const ownerRepo = parseOwnerRepo();
  if (!ownerRepo) return null;

  const { owner, repo } = ownerRepo;
  const pathname = location.pathname;
  const refs = resolveRefs(pathname);

  cachedContext = { owner, repo, ...refs };
  cachedPathname = location.pathname;
  return cachedContext;
}

/** Clear cached context (call on SPA navigation). */
export function clearRevisionContextCache(): void {
  cachedContext = null;
  cachedPathname = null;
}

type Refs = { baseRef: string | null; headRef: string | null };

const NO_REFS: Refs = { baseRef: null, headRef: null };

function refsFromSha(sha: string): Refs {
  return { baseRef: `${sha}^`, headRef: sha };
}

function resolveRefs(pathname: string): Refs {
  const route = parseDiffRoute(pathname);
  if (!route) return NO_REFS;

  switch (route.kind) {
    case "commit":
      return extractCommitRefs() ?? refsFromSha(route.sha);

    case "pr-commit":
      return (
        extractCommitRefs() ?? extractPreviewPrRefs() ?? refsFromSha(route.sha)
      );

    case "pr-changes":
      return extractPreviewPrRefs() ?? NO_REFS;

    case "pr-files": {
      // Classic UI: only headRef is reliable (end_commit_oid).
      // baseRef (base_commit_oid) is the head's parent, not the merge base.
      const el = document.querySelector<HTMLElement>(
        '[data-url*="show_partial_comparison"]',
      );
      if (el) {
        const dataUrl = el.getAttribute("data-url") ?? "";
        return {
          baseRef: null,
          headRef: extractUrlParam(dataUrl, "end_commit_oid"),
        };
      }
      return NO_REFS;
    }

    case "compare":
      return parseCompareRefs(route.spec);
  }
}

// --- Parsing helpers ---

function parseOwnerRepo(): { owner: string; repo: string } | null {
  const match = location.pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function extractUrlParam(url: string, param: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return null;
  const params = new URLSearchParams(url.slice(queryStart));
  return params.get(param);
}

function extractCommitRefs(): {
  baseRef: string | null;
  headRef: string | null;
} | null {
  return extractFromEmbeddedJson("commit", (payload) => {
    const commit = payload?.commit;
    if (!commit) return null;

    const firstParent =
      Array.isArray(commit.parents) && commit.parents.length > 0
        ? commit.parents[0]
        : null;

    const baseRef =
      typeof firstParent === "string"
        ? firstParent
        : (firstParent?.oid ?? null);
    const headRef = commit.oid ?? null;
    // Return null if both refs are empty so ?? fallback chains work
    if (!baseRef && !headRef) return null;
    return { baseRef, headRef };
  });
}

function extractPreviewPrRefs(): {
  baseRef: string | null;
  headRef: string | null;
} | null {
  // Try both route keys: "pullRequestsChangesRoute" is used on fresh page loads,
  // "pullRequestsChangesWithRangeRoute" is used after SPA navigation from commit pages.
  const routeKeys = [
    "pullRequestsChangesRoute",
    "pullRequestsChangesWithRangeRoute",
  ] as const;

  for (const key of routeKeys) {
    const refs = extractFromEmbeddedJson(key, (payload) => {
      const fullDiff = (payload as Record<string, unknown>)[key] as
        | Record<string, unknown>
        | undefined;
      const comparison = fullDiff?.comparison as
        | Record<string, unknown>
        | undefined;
      const diff = comparison?.fullDiff as Record<string, unknown> | undefined;
      if (!diff) return null;
      const baseRef = typeof diff.baseOid === "string" ? diff.baseOid : null;
      const headRef = typeof diff.headOid === "string" ? diff.headOid : null;
      // Return null if both refs are empty so ?? fallback chains work
      if (!baseRef && !headRef) return null;
      return { baseRef, headRef };
    });
    if (refs) return refs;
  }
  return null;
}

/** Resolve refs from a compare spec like "main...feature" (already URL-stripped). */
function parseCompareRefs(compareSpec: string): Refs {
  const separatorIndex = compareSpec.indexOf("...");
  if (separatorIndex === -1) return NO_REFS;

  const rawBase = decodeURIComponent(compareSpec.slice(0, separatorIndex));
  const rawHead = decodeURIComponent(compareSpec.slice(separatorIndex + 3));

  // Cross-fork refs (e.g. someone:branch) are not supported
  return {
    baseRef: rawBase.includes(":") ? null : rawBase,
    headRef: rawHead.includes(":") ? null : rawHead,
  };
}

/**
 * Search <script type="application/json"> tags for embedded payload data.
 * Returns the result of the extractor function, or null if not found.
 */
function extractFromEmbeddedJson<T>(
  markerKey: string,
  extractor: (payload: Record<string, unknown>) => T | null,
): T | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"]',
  );
  for (const script of scripts) {
    const text = script.textContent;
    if (!text || !text.includes(markerKey)) continue;
    try {
      const json = JSON.parse(text);
      const payload = json?.payload;
      if (!payload) continue;
      const result = extractor(payload);
      if (result) return result;
    } catch (error) {
      console.warn(
        "[GitHub Better CSV Diff] Failed to parse embedded revision JSON:",
        markerKey,
        error,
      );
    }
  }
  return null;
}
