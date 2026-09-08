import {
  ATTENTION_CARD_OPEN_TYPE,
  type CardOpenResponse,
} from '../shared/card-messages';

export type CardLaunchResult =
  CardOpenResponse | { ok: false; reason: 'protected_page' };

function response(value: unknown): CardOpenResponse | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<CardOpenResponse>;
  if (item.ok === true) return { ok: true };
  if (
    item.ok === false &&
    ['not_article', 'unavailable', 'profile_required'].includes(
      item.reason ?? '',
    )
  )
    return { ok: false, reason: item.reason };
  return null;
}

/** Opens the page-owned card. The popup never captures or evaluates an article. */
export async function openCardOnActiveTab(
  assertCurrent: () => Promise<void> = async () => undefined,
): Promise<CardLaunchResult> {
  await assertCurrent();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url))
    return { ok: false, reason: 'protected_page' };
  const tabId = tab.id;
  const send = async (): Promise<CardOpenResponse | null> => {
    await assertCurrent();
    try {
      return response(
        await chrome.tabs.sendMessage(tabId, {
          type: ATTENTION_CARD_OPEN_TYPE,
        }),
      );
    } catch {
      return null;
    }
  };
  const first = await send();
  if (first) return first;
  await assertCurrent();
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  return (await send()) ?? { ok: false, reason: 'unavailable' };
}
