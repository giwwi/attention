/** URLs that are likely to represent one opened material rather than a feed. */
export function isArticlePagePath(pathname: string): boolean {
  let path = pathname.toLocaleLowerCase();
  try {
    path = decodeURIComponent(path).toLocaleLowerCase();
  } catch {
    /* Keep malformed percent escapes as literal URL text. */
  }
  return (
    /\/(p|post|posts|article|articles|story|stories|blog|news)\//u.test(path) ||
    /\/20\d{2}\/(?:\d{1,2}\/){0,2}[^/]+/u.test(path)
  );
}
