declare const __ATTENTION_NOTION_OAUTH_BROKER_URL__: string;

export const NOTION_API_VERSION = '2026-03-11';
export const NOTION_OAUTH_BROKER_URL =
  typeof __ATTENTION_NOTION_OAUTH_BROKER_URL__ === 'string'
    ? __ATTENTION_NOTION_OAUTH_BROKER_URL__.trim()
    : '';

export function notionOAuthConfigured(): boolean {
  try {
    const url = new URL(NOTION_OAUTH_BROKER_URL);
    return url.protocol === 'https:' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}
