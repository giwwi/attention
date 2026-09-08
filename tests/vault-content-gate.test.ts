import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VAULT_CHANGED_TYPE, VAULT_STATUS_TYPE } from '../src/vault/messages';
import { ATTENTION_INPUTS_INVALIDATED_TYPE } from '../src/background/input-invalidation';
import { UI_LANGUAGE_GET_TYPE } from '../src/shared/types';
import { ATTENTION_CARD_OPEN_TYPE } from '../src/shared/card-messages';

const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  handoff: vi.fn(),
  prompt: vi.fn(),
  dispose: vi.fn(),
  open: vi.fn(),
}));
vi.mock('../src/content/profile-handoff-notice', () => ({
  installChatGptProfileHandoffNotice: runtime.handoff,
}));
vi.mock('../src/content/hover-preview', () => ({
  installHoverPreview: runtime.prompt,
}));
vi.mock('../src/content/runtime', () => ({
  startContentRuntime: runtime.start,
}));
type GateScope = typeof globalThis & { __attentionVaultGateStop?: () => void };
type Listener = (
  message: unknown,
  sender: { id?: string },
  respond: (value: unknown) => void,
) => void;

describe('locked content runtime', () => {
  let listener: Listener;
  let send: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    runtime.start.mockReset().mockReturnValue(runtime.stop);
    runtime.stop.mockReset();
    runtime.handoff.mockReset().mockResolvedValue(undefined);
    runtime.dispose.mockReset();
    runtime.open.mockReset().mockResolvedValue({ ok: true });
    runtime.prompt.mockReset().mockReturnValue({
      dispose: runtime.dispose,
      openCurrentArticle: runtime.open,
    });
    send = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'attention-id',
        sendMessage: (message: { type: string }) =>
          message.type === UI_LANGUAGE_GET_TYPE
            ? Promise.resolve({ ok: false })
            : send(message),
        onMessage: {
          addListener: (value: Listener) => {
            listener = value;
          },
          removeListener: vi.fn(),
        },
      },
    });
  });
  afterEach(() => {
    (globalThis as GateScope).__attentionVaultGateStop?.();
    delete (globalThis as GateScope).__attentionVaultGateStop;
    vi.unstubAllGlobals();
  });

  it('sends only a public status query and never starts collection while locked', async () => {
    send.mockResolvedValue({ ok: true, unlocked: false });
    await import('../src/content/index');
    await Promise.resolve();
    expect(send.mock.calls).toEqual([[{ type: VAULT_STATUS_TYPE }]]);
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it('offers setup before a vault exists but removes the invitation when an existing vault is locked', async () => {
    send.mockResolvedValue({ ok: true, unlocked: false, unconfigured: true });
    await import('../src/content/index');
    await Promise.resolve();
    expect(runtime.prompt).toHaveBeenCalledOnce();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([[{ type: VAULT_STATUS_TYPE }]]);
    send.mockResolvedValue({ ok: true, unlocked: false, unconfigured: false });
    listener({ type: VAULT_CHANGED_TYPE }, { id: 'attention-id' }, vi.fn());
    await Promise.resolve();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(runtime.prompt).toHaveBeenCalledOnce();
  });

  it('suspends immediately on a trusted lifecycle event while the new status is still pending', async () => {
    send.mockResolvedValueOnce({
      ok: true,
      unlocked: true,
      profileReady: true,
      epoch: 'one',
    });
    await import('../src/content/index');
    await Promise.resolve();
    expect(runtime.start).toHaveBeenCalledTimes(1);
    send.mockReturnValue(new Promise(() => undefined));
    listener({ type: VAULT_CHANGED_TYPE }, { id: 'attention-id' }, vi.fn());
    expect(runtime.stop).toHaveBeenCalledTimes(1);
  });

  it('ignores an old unlocked reply that arrives after a later lock notification', async () => {
    let finish!: (value: unknown) => void;
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await import('../src/content/index');
    send.mockResolvedValueOnce({ ok: true, unlocked: false });
    listener({ type: VAULT_CHANGED_TYPE }, { id: 'attention-id' }, vi.fn());
    await Promise.resolve();
    finish({ ok: true, unlocked: true, profileReady: true, epoch: 'old' });
    await Promise.resolve();
    expect(runtime.start).not.toHaveBeenCalled();
  });
  it('shows only setup until a profile is saved, then replaces it with the full runtime', async () => {
    send.mockResolvedValue({
      ok: true,
      unlocked: true,
      profileReady: false,
      epoch: 'one',
    });
    await import('../src/content/index');
    await Promise.resolve();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.handoff).toHaveBeenCalledOnce();
    expect(runtime.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ profileRequired: true }),
    );
    const response = vi.fn();
    listener(
      { type: ATTENTION_CARD_OPEN_TYPE },
      { id: 'attention-id' },
      response,
    );
    expect(response).toHaveBeenCalledWith({
      ok: false,
      reason: 'profile_required',
    });

    send.mockResolvedValue({
      ok: true,
      unlocked: true,
      profileReady: true,
      epoch: 'one',
    });
    listener(
      {
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['personalProfile'],
      },
      { id: 'attention-id' },
      vi.fn(),
    );
    await Promise.resolve();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.dispose).toHaveBeenCalledOnce();

    send.mockReturnValue(new Promise(() => undefined));
    listener(
      {
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['personalProfile'],
      },
      { id: 'attention-id' },
      vi.fn(),
    );
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  it('fails closed for a missing readiness flag and ignores forged profile notifications', async () => {
    send.mockResolvedValue({ ok: true, unlocked: true, epoch: 'one' });
    await import('../src/content/index');
    await Promise.resolve();
    expect(runtime.start).not.toHaveBeenCalled();
    listener(
      {
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['personalProfile'],
      },
      { id: 'another-extension' },
      vi.fn(),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not reactivate from an old ready reply after profile deletion', async () => {
    let finish!: (value: unknown) => void;
    send.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await import('../src/content/index');
    send.mockResolvedValueOnce({
      ok: true,
      unlocked: true,
      profileReady: false,
      epoch: 'one',
    });
    listener(
      {
        type: ATTENTION_INPUTS_INVALIDATED_TYPE,
        changedKeys: ['personalProfile'],
      },
      { id: 'attention-id' },
      vi.fn(),
    );
    await Promise.resolve();
    finish({ ok: true, unlocked: true, profileReady: true, epoch: 'one' });
    await Promise.resolve();
    expect(runtime.start).not.toHaveBeenCalled();
  });
});
