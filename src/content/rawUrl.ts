export function rawFileUrl(
  owner: string,
  repo: string,
  ref: string,
  filepath: string,
): string {
  const encodedPath = filepath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  // Absolute URL: Firefox content scripts resolve relative URLs against the
  // extension origin (moz-extension://), not the page, so fetch() throws.
  return `${location.origin}/${owner}/${repo}/raw/${ref}/${encodedPath}`;
}
