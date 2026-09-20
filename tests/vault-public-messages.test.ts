import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installVaultMessages } from '../src/background/vault';
import { PROFILE_WEB_URLS } from '../src/profile/provider-sites';
import {
  PROFILE_SETUP_OPEN_TYPE,
  VAULT_HANDOFF_NOTICE_TYPE,
  VAULT_STATUS_TYPE,
} from '../src/vault/messages';
const vault = vi.hoisted(() => ({
  status: vi.fn(),
  epoch: vi.fn(),
  settings: vi.fn(),
  handoff: vi.fn(),
  firstRunNotice: vi.fn(),
}));
vi.mock('../src/vault/storage', () => ({
  getVaultStatus: vault.status,
  getVaultEpoch: vault.epoch,
  onVaultStateChanged: vi.fn(),
  privateStorage: { get: vault.settings },
}));
vi.mock('../src/profile/storage', () => ({
  loadProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/onboarding/handoff/state', () => ({
  loadProfileHandoffState: vault.handoff,
}));
vi.mock('../src/onboarding/handoff/first-run-notice', () => ({
  loadFirstRunHandoffNotice: vault.firstRunNotice,
}));
let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let create: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vault.status.mockReset().mockResolvedValue('unconfigured');
  vault.epoch.mockReset().mockResolvedValue('epoch');
  vault.settings.mockReset().mockResolvedValue({ interfaceLanguage: 'ru' });
  vault.handoff.mockReset().mockResolvedValue(null);
  vault.firstRunNotice.mockReset().mockResolvedValue(null);
  create = vi.fn().mockResolvedValue({ id: 7 });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'attention',
      getURL: (path: string) => `chrome-extension://attention/${path}`,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    tabs: { create },
  });
  installVaultMessages();
});

describe('ChatGPT notice boundary', () => {
  const sender = { id: 'attention', frameId: 0, url: 'https://chatgpt.com/' };
  const publicFlags = {
    profileImportProvider: 'chatgpt',
    profileImportStage: 'waiting-for-response',
    method: 'clipboard-and-web',
    promptCopied: true,
  };

  it.each(['gemini', 'copilot', 'perplexity', 'claude'] as const)(
    'returns a %s notice only to its own site',
    async (provider) => {
      vault.firstRunNotice.mockResolvedValue({
        ...publicFlags,
        profileImportProvider: provider,
        language: 'en',
      });
      expect(
        await request(VAULT_HANDOFF_NOTICE_TYPE, {
          ...sender,
          url: PROFILE_WEB_URLS[provider],
        }),
      ).toEqual({
        ok: true,
        state: {
          ...publicFlags,
          profileImportProvider: provider,
          language: 'en',
        },
      });
      expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
        ok: true,
        state: null,
      });
    },
  );

  it('returns only public flags before password setup, never draft data or document identifiers', async () => {
    vault.firstRunNotice.mockResolvedValue({
      ...publicFlags,
      language: 'de',
      ownerDocumentId: 'doc',
      startedAt: 'now',
      privateDraft: 'secret',
    });
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
      ok: true,
      state: { ...publicFlags, language: 'de' },
    });
    expect(vault.handoff).not.toHaveBeenCalled();
    expect(vault.settings).not.toHaveBeenCalled();
  });
  it('returns no notice without an active setup document', async () => {
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
      ok: true,
      state: null,
    });
  });
  it('never opens private storage or the first-run notice while locked', async () => {
    vault.status.mockResolvedValue('locked');
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
      ok: false,
    });
    expect(vault.handoff).not.toHaveBeenCalled();
    expect(vault.firstRunNotice).not.toHaveBeenCalled();
  });
  it('keeps the notice working for existing unlocked profiles without exposing stored private fields', async () => {
    vault.status.mockResolvedValue('unlocked');
    vault.handoff.mockResolvedValue({
      ...publicFlags,
      generation: 'private-generation',
      sourceTabId: 12,
    });
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
      ok: true,
      state: { ...publicFlags, language: 'ru' },
    });
    expect(vault.firstRunNotice).not.toHaveBeenCalled();
  });
  it('rejects a reply if the vault state changes during the read', async () => {
    vault.status
      .mockResolvedValueOnce('unconfigured')
      .mockResolvedValue('locked');
    vault.firstRunNotice.mockResolvedValue({ ...publicFlags, language: 'en' });
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, sender)).toEqual({
      ok: false,
    });
  });
  it.each([
    { ...sender, id: 'other' },
    { ...sender, frameId: 1 },
    { ...sender, url: 'http://chatgpt.com/' },
    { ...sender, url: 'https://chatgpt.com.attacker.example/' },
    { ...sender, url: 'https://example.com/' },
    { ...sender, url: 'https://gemini.google.com.attacker.example/' },
    { ...sender, url: 'https://copilot.microsoft.com.attacker.example/' },
    { ...sender, url: 'https://perplexity.ai.attacker.example/' },
    { ...sender, url: 'https://google.com/' },
  ])('ignores untrusted senders %j', async (source) => {
    expect(await request(VAULT_HANDOFF_NOTICE_TYPE, source)).toEqual({
      ok: false,
    });
    expect(vault.firstRunNotice).not.toHaveBeenCalled();
    expect(vault.handoff).not.toHaveBeenCalled();
  });
});
function request(type: string, sender: chrome.runtime.MessageSender) {
  return new Promise((respond) => {
    listener({ type, url: 'https://untrusted.example/' }, sender, respond);
  });
}
describe('public setup boundary', () => {
  it.each(['unconfigured', 'locked'])(
    'distinguishes %s without returning private data',
    async (status) => {
      vault.status.mockResolvedValue(status);
      expect(await request(VAULT_STATUS_TYPE, { id: 'attention' })).toEqual({
        ok: true,
        unlocked: false,
        unconfigured: status === 'unconfigured',
      });
    },
  );
  it('opens only its fixed setup page for an own top-frame content script', async () => {
    expect(
      await request(PROFILE_SETUP_OPEN_TYPE, {
        id: 'attention',
        frameId: 0,
        url: 'https://example.com/article',
        tab: { id: 1 } as chrome.tabs.Tab,
      }),
    ).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://attention/popup.html?sourceTab=1',
      active: true,
    });
  });
  it.each([
    { id: 'other', frameId: 0, url: 'https://example.com', tab: { id: 1 } },
    { id: 'attention', frameId: 1, url: 'https://example.com', tab: { id: 1 } },
    { id: 'attention', frameId: 0, url: 'https://example.com' },
    {
      id: 'attention',
      frameId: 0,
      url: 'chrome-extension://other/page',
      tab: { id: 1 },
    },
  ])('rejects an ineligible sender: %j', async (sender) => {
    expect(
      await request(
        PROFILE_SETUP_OPEN_TYPE,
        sender as chrome.runtime.MessageSender,
      ),
    ).toEqual({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });
});
