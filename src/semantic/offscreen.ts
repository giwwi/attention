import { SEMANTIC_ENGINE } from './model';
const worker = new Worker(chrome.runtime.getURL('semantic-worker.js'), {
  type: 'module',
});
const pending = new Map<string, (response: unknown) => void>();
let heartbeat: ReturnType<typeof setInterval> | undefined;
function updateHeartbeat(): void {
  if (!pending.size) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  } else if (!heartbeat) {
    // Keep the background response channel alive only while bounded work is running.
    heartbeat = setInterval(() => {
      void chrome.runtime
        .sendMessage({ type: `${SEMANTIC_ENGINE}/HEARTBEAT` })
        .catch(() => undefined);
    }, 15_000);
  }
}
worker.onmessage = ({ data }) => {
  if (data.progress) {
    void chrome.runtime
      .sendMessage({ type: `${SEMANTIC_ENGINE}/PROGRESS`, ...data.progress })
      .catch(() => undefined);
    return;
  }
  pending.get(data.id)?.(data);
  pending.delete(data.id);
  updateHeartbeat();
};
worker.onerror = () => {
  for (const respond of pending.values()) respond({ ok: false });
  pending.clear();
  updateHeartbeat();
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== SEMANTIC_ENGINE) return;
  // Only our background service worker may submit personal text to this worker.
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url && sender.url !== chrome.runtime.getURL('background.js')) ||
    sender.tab
  )
    return;
  const id = crypto.randomUUID();
  pending.set(id, respond);
  updateHeartbeat();
  worker.postMessage({ id, action: message.action, input: message.input });
  return true;
});
