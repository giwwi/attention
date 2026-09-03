export type PopupStatusKind = 'default' | 'success' | 'error';

export function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

export function setPopupStatus(
  element: HTMLParagraphElement,
  kind: PopupStatusKind,
  message: string,
): void {
  element.className = kind === 'default' ? 'status' : `status ${kind}`;
  element.textContent = message;
}

export function closeExtensionPopup(): void {
  if (window.location.protocol !== 'chrome-extension:') return;
  window.setTimeout(() => window.close(), 80);
}
