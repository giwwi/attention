import {
  privateStorage,
  privateStorageChanges,
  onVaultStateChanged,
  getVaultStatus,
} from '../vault/storage';
import {
  assertDataOperationCurrent,
  beginDataOperation,
  DATA_GENERATION_KEY,
  observeDataOperation,
  commitDataOperation,
} from '../privacy/data-operations';
import {
  MODEL_CACHE,
  MODEL_FILES,
  MODEL_INSTALLED_KEY,
  MODEL_REVISION,
  modelUrl,
  SEMANTIC_ENGINE,
  SEMANTIC_SETTINGS_KEY,
  type SemanticStatus,
} from './model';
import type { SemanticInput, SemanticScores } from './selection';

let creating: Promise<void> | undefined;
let closing: Promise<void> = Promise.resolve();
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;
let epoch = 0;
let controlRevision = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
let status: SemanticStatus = {
  state: 'off',
  progress: 0,
  installed: false,
  enabled: false,
};

async function close(): Promise<void> {
  epoch++;
  clearTimeout(idle);
  const previous = closing;
  closing = previous
    .catch(() => undefined)
    .then(async () => {
      await creating?.catch(() => undefined);
      const documents = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL('semantic-offscreen.html')],
      });
      if (documents.length) await chrome.offscreen.closeDocument();
    });
  await closing;
}
async function ensureDocument(): Promise<void> {
  await closing;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL('semantic-offscreen.html')],
  });
  if (contexts.length) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: 'semantic-offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          'Run optional, on-device passage embeddings in a worker without blocking article cards.',
      })
      .finally(() => {
        creating = undefined;
      });
  await creating;
}
async function installed(): Promise<boolean> {
  // Read without opening: a concurrent status poll must not recreate a deleted cache.
  const marker = await caches.match(MODEL_INSTALLED_KEY, {
    cacheName: MODEL_CACHE,
  });
  if (!marker || (await marker.text()) !== MODEL_REVISION) return false;
  return (
    await Promise.all(
      MODEL_FILES.map((f) =>
        caches.match(modelUrl(f.path), { cacheName: MODEL_CACHE }),
      ),
    )
  ).every(Boolean);
}
export async function semanticEnabled(): Promise<boolean> {
  const values = await privateStorage.get(SEMANTIC_SETTINGS_KEY);
  return (
    (values[SEMANTIC_SETTINGS_KEY] as { enabled?: boolean } | undefined)
      ?.enabled === true
  );
}
export async function semanticStatus(): Promise<SemanticStatus> {
  return {
    ...status,
    enabled: await semanticEnabled(),
    installed: await installed(),
  };
}

async function run(
  action: 'install' | 'rank',
  input?: SemanticInput,
): Promise<unknown> {
  if (queued >= 3) throw new Error('Local search is busy');
  queued++;
  const started = epoch;
  const task = queue
    .catch(() => undefined)
    .then(async () => {
      if (started !== epoch) throw new Error('Local search was cancelled');
      clearTimeout(idle);
      await ensureDocument();
      if (started !== epoch) throw new Error('Local search was cancelled');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          chrome.runtime.sendMessage({ type: SEMANTIC_ENGINE, action, input }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                void close();
                reject(new Error('Local search timed out'));
              },
              action === 'install' ? 600_000 : 120_000,
            );
          }),
        ]);
        if (!response?.ok || started !== epoch) {
          status = {
            ...status,
            failure:
              typeof response?.failure === 'string'
                ? response.failure.slice(0, 100)
                : 'cancelled-or-worker-unavailable',
          };
          throw new Error('Local search unavailable');
        }
        return response.result;
      } finally {
        clearTimeout(timer);
        if (started === epoch)
          idle = setTimeout(() => {
            void close();
          }, 180_000);
      }
    })
    .finally(() => {
      queued--;
    });
  queue = task;
  return task;
}

export async function rankLocally(
  input: SemanticInput,
  signal: AbortSignal,
): Promise<SemanticScores> {
  if (signal.aborted || !(await semanticEnabled()) || !(await installed()))
    throw new Error('Local search disabled');
  const cancel = () => {
    void close();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const scores = (await run('rank', input)) as SemanticScores;
    if (signal.aborted || !(await semanticEnabled()))
      throw new Error('Local search disabled');
    return scores;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export async function controlSemantic(
  action: unknown,
): Promise<SemanticStatus> {
  if (action === 'status') return semanticStatus();
  if (action === 'enable' && ['downloading', 'loading'].includes(status.state))
    return semanticStatus();
  const revision = ++controlRevision;
  const operation = await beginDataOperation();
  if (revision !== controlRevision)
    throw new Error('Local search was cancelled');
  if (action === 'disable' || action === 'remove') {
    await close();
    await commitDataOperation(operation, () =>
      privateStorage.set({ [SEMANTIC_SETTINGS_KEY]: { enabled: false } }),
    );
    if (action === 'remove' || !(await installed()))
      await caches.delete(MODEL_CACHE);
    status = { state: 'off', progress: 0, installed: false, enabled: false };
  } else if (action === 'enable') {
    const observation = await observeDataOperation(operation);
    const cancel = () => {
      void close();
    };
    observation.signal.addEventListener('abort', cancel, { once: true });
    try {
      status = {
        state: 'downloading',
        progress: 0,
        installed: false,
        enabled: false,
      };
      if (!(await installed())) await run('install');
      await assertDataOperationCurrent(operation);
      await commitDataOperation(operation, () => {
        if (revision !== controlRevision)
          throw new Error('Local search was cancelled');
        return privateStorage.set({
          [SEMANTIC_SETTINGS_KEY]: { enabled: true },
        });
      });
      status = {
        state: 'ready',
        progress: 100,
        installed: true,
        enabled: true,
      };
    } catch {
      if (revision === controlRevision) {
        if (!(await installed())) await caches.delete(MODEL_CACHE);
        status = { ...status, state: 'error', enabled: false };
      }
      throw new Error('Could not enable local search');
    } finally {
      observation.signal.removeEventListener('abort', cancel);
      observation.dispose();
    }
  }
  return semanticStatus();
}

export function installSemanticLifecycle(): void {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type !== `${SEMANTIC_ENGINE}/PROGRESS` ||
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('semantic-offscreen.html')
    )
      return;
    if (['downloading', 'loading', 'ready'].includes(message.state))
      status = {
        ...status,
        state: message.state,
        progress: Math.max(0, Math.min(100, Number(message.progress) || 0)),
      };
  });
  onVaultStateChanged(() => {
    void getVaultStatus()
      .then((value) => {
        if (value !== 'unlocked') void close();
      })
      .catch(() => {
        void close();
      });
  });
  privateStorageChanges.addListener((changes) => {
    if (DATA_GENERATION_KEY in changes) {
      void close();
      return;
    }
    if (
      SEMANTIC_SETTINGS_KEY in changes &&
      (
        changes[SEMANTIC_SETTINGS_KEY]?.newValue as
          { enabled?: boolean } | undefined
      )?.enabled !== true
    )
      void close();
  });
}
