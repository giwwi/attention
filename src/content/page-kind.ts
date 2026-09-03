/** URLs that are likely to represent one opened material rather than a feed. */
export function isArticlePagePath(pathname: string): boolean {
  const path = decodeURIComponent(pathname).toLocaleLowerCase();
  return (
    /\/(p|post|posts|article|articles|story|stories|blog|news)\//u.test(path) ||
    /\/20\d{2}\/(?:\d{1,2}\/){0,2}[^/]+/u.test(path)
  );
}
