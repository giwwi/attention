type ScrollSubscriber = () => void;

const subscribers = new Set<ScrollSubscriber>();
let frameId = 0;
let listening = false;

function unlockNextFrame(): void {
  frameId = 0;
}

function notifySubscribers(): void {
  for (const subscriber of subscribers) subscriber();
}

function handleNativeScroll(): void {
  if (frameId !== 0) return;
  // React immediately so transient hover UI never lingers while the page is
  // moving, then suppress every additional event until the next paint.
  frameId = window.requestAnimationFrame(unlockNextFrame);
  notifySubscribers();
}

function stopListeningWhenUnused(): void {
  if (subscribers.size > 0 || !listening) return;
  window.removeEventListener('scroll', handleNativeScroll, true);
  if (frameId !== 0) window.cancelAnimationFrame(frameId);
  frameId = 0;
  listening = false;
}

/** One passive browser listener shared by hover UI and reading progress. */
export function subscribeToScroll(
  subscriber: ScrollSubscriber,
  signal: AbortSignal,
): void {
  subscribers.add(subscriber);
  if (!listening) {
    // Capture also sees scrolls emitted by nested readers (for example the
    // Substack article modal). One window listener therefore covers both the
    // page viewport and internal scrolling containers.
    window.addEventListener('scroll', handleNativeScroll, {
      capture: true,
      passive: true,
    });
    listening = true;
  }

  signal.addEventListener(
    'abort',
    () => {
      subscribers.delete(subscriber);
      stopListeningWhenUnused();
    },
    { once: true },
  );
}
