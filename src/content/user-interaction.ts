/** Ignore DOM events manufactured by the page hosting the content script. */
export function isTrustedUserInteraction(event: Event): boolean {
  return event.isTrusted;
}
