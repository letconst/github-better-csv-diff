/**
 * Route detection for GitHub diff-related pages.
 * Single source of truth for the URL pattern of every supported diff route —
 * used both to gate MutationObserver startup and to resolve revision refs.
 */

// Matched routes:
//   /owner/repo/pull/123/files        (Classic UI)
//   /owner/repo/pull/123/changes      (Preview UI)
//   /owner/repo/pull/123/changes/abc  (Preview UI commit)
//   /owner/repo/pull/123/commits/abc  (Classic UI commit)
//   /owner/repo/commit/abc1234        (standalone commit)
//   /owner/repo/compare/main...feat   (compare view)
//
// NOT matched:
//   /owner/repo/pull/123              (conversation tab)
//   /owner/repo/issues                (issues list)
//   /owner/repo                       (repo root)

export type DiffRoute =
  | { kind: "pr-files" }
  | { kind: "pr-changes" }
  | { kind: "pr-commit"; sha: string }
  | { kind: "commit"; sha: string }
  | { kind: "compare"; spec: string };

const PR_FILES_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/files\/?$/i;
const PR_CHANGES_RE = /^\/[^/]+\/[^/]+\/pull\/\d+\/changes\/?$/i;
const PR_COMMIT_RE =
  /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:changes|commits)\/([0-9a-f]{7,40})\/?$/i;
const COMMIT_RE = /^\/[^/]+\/[^/]+\/commit\/([0-9a-f]{7,40})\/?$/i;
const COMPARE_RE = /^\/[^/]+\/[^/]+\/compare\/(.+)$/i;

/** Classify the pathname as one of the supported diff routes, or null. */
export function parseDiffRoute(
  pathname: string = location.pathname,
): DiffRoute | null {
  if (PR_FILES_RE.test(pathname)) return { kind: "pr-files" };
  if (PR_CHANGES_RE.test(pathname)) return { kind: "pr-changes" };
  const prCommit = pathname.match(PR_COMMIT_RE);
  if (prCommit) return { kind: "pr-commit", sha: prCommit[1] };
  const commit = pathname.match(COMMIT_RE);
  if (commit) return { kind: "commit", sha: commit[1] };
  const compare = pathname.match(COMPARE_RE);
  if (compare) return { kind: "compare", spec: compare[1] };
  return null;
}

export function isDiffRoute(pathname: string = location.pathname): boolean {
  return parseDiffRoute(pathname) !== null;
}
