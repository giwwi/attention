import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installVaultMessages } from '../src/background/vault';
import {
  PROFILE_SETUP_OPEN_TYPE,
  VAULT_STATUS_TYPE,
} from '../src/vault/messages';
const vault = vi.hoisted(() => ({ status: vi.fn(), epoch: vi.fn() }));
vi.mock('../src/vault/storage', () => ({
  getVaultStatus: vault.status,
  getVaultEpoch: vault.epoch,
  onVaultStateChanged: vi.fn(),
}));
vi.mock('../src/profile/storage', () => ({
  loadProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/onboarding/handoff/state', () => ({
  loadProfileHandoffState: vi.fn(),
}));
let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let create: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vault.status.mockReset().mockResolvedValue('unconfigured');
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
      url: 'chrome-extension://attention/popup.html',
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
