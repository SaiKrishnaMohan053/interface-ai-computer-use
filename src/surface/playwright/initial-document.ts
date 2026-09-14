/**
 * A newly created Playwright page has no application document yet.
 * Discovery may inspect this state only to decide whether entry navigation is
 * required, so running the full application DOM collector is unnecessary.
 */
export function isUninitializedPlaywrightDocument(url: string, markup: string): boolean {
  if (url !== 'about:blank') return false;

  const meaningfulMarkup = markup
    .replace(/<!doctype[^>]*>/giu, '')
    .replace(/<\/?(?:html|head|body)(?:\s[^>]*)?>/giu, '')
    .trim();

  return meaningfulMarkup.length === 0;
}
