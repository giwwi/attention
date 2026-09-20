import type { ExternalProfileSource } from './schema';

export type WebProfileProvider = Exclude<ExternalProfileSource, 'other'>;

export const PROFILE_WEB_URLS: Record<WebProfileProvider, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/',
  copilot: 'https://copilot.microsoft.com/',
  perplexity: 'https://www.perplexity.ai/',
};

/** The notice may appear only on the selected assistant's own HTTPS origin. */
export function profileProviderAtUrl(value: string): WebProfileProvider | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname;
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com'))
      return 'chatgpt';
    if (host === 'claude.ai' || host === 'www.claude.ai') return 'claude';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'copilot.microsoft.com') return 'copilot';
    if (host === 'perplexity.ai' || host === 'www.perplexity.ai')
      return 'perplexity';
    return null;
  } catch {
    return null;
  }
}
