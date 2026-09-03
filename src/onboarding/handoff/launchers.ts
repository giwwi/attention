import type { ProfileHandoffMethod, ProfileHandoffProviderId } from './state';

export const CHATGPT_PROFILE_URL = 'https://chatgpt.com/';
export const CLAUDE_PROFILE_WEB_URL = 'https://claude.ai/new';

export interface ProfileHandoffResult {
  provider: ProfileHandoffProviderId;
  method: ProfileHandoffMethod;
  promptCopied: boolean;
  providerOpened: boolean;
}

export interface ProfileHandoffEnvironment {
  copyText(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}

export type ProfileHandoffPrepared = Pick<
  ProfileHandoffResult,
  'method' | 'promptCopied'
>;

const browserEnvironment: ProfileHandoffEnvironment = {
  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },
  async openUrl(url) {
    await chrome.tabs.create({ url, active: true });
  },
};

async function tryCopy(
  prompt: string,
  environment: ProfileHandoffEnvironment,
): Promise<boolean> {
  try {
    await environment.copyText(prompt);
    return true;
  } catch {
    return false;
  }
}

async function tryOpen(
  url: string,
  environment: ProfileHandoffEnvironment,
): Promise<boolean> {
  try {
    await environment.openUrl(url);
    return true;
  } catch {
    return false;
  }
}

export async function prepareChatGptProfileHandoff(
  prompt: string,
  environment: ProfileHandoffEnvironment = browserEnvironment,
): Promise<ProfileHandoffPrepared> {
  return {
    method: 'clipboard-and-web',
    promptCopied: await tryCopy(prompt, environment),
  };
}

export function buildClaudeProfileDeepLink(prompt: string): string {
  return `claude://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

export async function launchProfileHandoff(
  provider: ProfileHandoffProviderId,
  prompt: string,
  environment: ProfileHandoffEnvironment = browserEnvironment,
  onPrepared?: (prepared: ProfileHandoffPrepared) => void | Promise<void>,
): Promise<ProfileHandoffResult> {
  if (provider === 'other') {
    return {
      provider,
      method: 'manual',
      promptCopied: false,
      providerOpened: false,
    };
  }

  if (provider === 'chatgpt') {
    const prepared = await prepareChatGptProfileHandoff(prompt, environment);
    await onPrepared?.(prepared);
    const providerOpened = await tryOpen(CHATGPT_PROFILE_URL, environment);
    return {
      provider,
      method: 'clipboard-and-web',
      promptCopied: prepared.promptCopied,
      providerOpened,
    };
  }

  await onPrepared?.({ method: 'deep-link', promptCopied: false });
  const deepLinkOpened = await tryOpen(
    buildClaudeProfileDeepLink(prompt),
    environment,
  );
  if (deepLinkOpened) {
    return {
      provider,
      method: 'deep-link',
      promptCopied: false,
      providerOpened: true,
    };
  }

  return launchClaudeWebFallback(prompt, environment, onPrepared);
}

export async function launchClaudeWebFallback(
  prompt: string,
  environment: ProfileHandoffEnvironment = browserEnvironment,
  onPrepared?: (prepared: ProfileHandoffPrepared) => void | Promise<void>,
): Promise<ProfileHandoffResult> {
  const promptCopied = await tryCopy(prompt, environment);
  await onPrepared?.({ method: 'clipboard-and-web', promptCopied });
  const providerOpened = await tryOpen(CLAUDE_PROFILE_WEB_URL, environment);
  return {
    provider: 'claude',
    method: 'clipboard-and-web',
    promptCopied,
    providerOpened,
  };
}
