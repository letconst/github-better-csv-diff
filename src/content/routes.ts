/**
 * Route detection for GitHub diff-related pages.
 * Used to gate MutationObserver startup to pages that actually contain diffs.
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
const DIFF_ROUTE_PATTERNS: RegExp[] = [
  /^\/[^/]+\/[^/]+\/pull\/\d+\/files\/?$/i,
  /^\/[^/]+\/[^/]+\/pull\/\d+\/changes\/?$/i,
  /^\/[^/]+\/[^/]+\/pull\/\d+\/changes\/[0-9a-f]{7,40}\/?$/i,
  /^\/[^/]+\/[^/]+\/pull\/\d+\/commits\/[0-9a-f]{7,40}\/?$/i,
  /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,40}\/?$/i,
  /^\/[^/]+\/[^/]+\/compare\/.+$/i,
];

export function isDiffRoute(pathname: string = location.pathname): boolean {
  return DIFF_ROUTE_PATTERNS.some((re) => re.test(pathname));
}
