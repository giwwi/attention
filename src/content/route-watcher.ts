export interface RouteWatcherOptions {
  fallbackIntervalMs: number;
}

interface RouteSubscriber {
  callback: () => void;
  fallbackIntervalMs: number;
}

const subscribers = new Set<RouteSubscriber>();
let scheduledCheckTimer = 0;
let settledCheckTimer = 0;
let fallbackId = 0;
let listenersInstalled = false;
let originalPushState: History['pushState'] | null = null;
let originalReplaceState: History['replaceState'] | null = null;
let wrappedPushState: History['pushState'] | null = null;
let wrappedReplaceState: History['replaceState'] | null = null;

function notifySubscribers(): void {
  for (const subscriber of subscribers) subscriber.callback();
}

function scheduleRouteCheck(): void {
  window.clearTimeout(scheduledCheckTimer);
  window.clearTimeout(settledCheckTimer);
  scheduledCheckTimer = window.setTimeout(notifySubscribers, 0);
  // SPA frameworks commonly publish the route before rendering the new view.
  // One delayed event-driven check catches that settled DOM without bringing
  // back the old high-frequency route polling loop.
  settledCheckTimer = window.setTimeout(notifySubscribers, 1_500);
}

function handleLinkClick(event: Event): void {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest('a[href]')) return;
  scheduleRouteCheck();
}

function restartFallback(): void {
  window.clearInterval(fallbackId);
  fallbackId = 0;
  if (subscribers.size === 0) return;
  const interval = Math.max(
    1_000,
    Math.min(
      ...Array.from(
        subscribers,
        ({ fallbackIntervalMs }) => fallbackIntervalMs,
      ),
    ),
  );
  fallbackId = window.setInterval(notifySubscribers, interval);
}

function installSharedListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  originalPushState = window.history.pushState;
  originalReplaceState = window.history.replaceState;
  wrappedPushState = function (
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPushState?.apply(this, args);
    scheduleRouteCheck();
  };
  wrappedReplaceState = function (
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplaceState?.apply(this, args);
    scheduleRouteCheck();
  };
  window.history.pushState = wrappedPushState;
  window.history.replaceState = wrappedReplaceState;
  window.addEventListener('popstate', notifySubscribers);
  window.addEventListener('hashchange', notifySubscribers);
  window.addEventListener('pageshow', notifySubscribers);
  document.addEventListener('click', handleLinkClick, true);
}

function removeSharedListenersWhenUnused(): void {
  if (subscribers.size > 0 || !listenersInstalled) return;
  listenersInstalled = false;
  window.clearTimeout(scheduledCheckTimer);
  window.clearTimeout(settledCheckTimer);
  window.clearInterval(fallbackId);
  scheduledCheckTimer = 0;
  settledCheckTimer = 0;
  fallbackId = 0;
  window.removeEventListener('popstate', notifySubscribers);
  window.removeEventListener('hashchange', notifySubscribers);
  window.removeEventListener('pageshow', notifySubscribers);
  document.removeEventListener('click', handleLinkClick, true);
  if (wrappedPushState && window.history.pushState === wrappedPushState) {
    window.history.pushState = originalPushState ?? window.history.pushState;
  }
  if (
    wrappedReplaceState &&
    window.history.replaceState === wrappedReplaceState
  ) {
    window.history.replaceState =
      originalReplaceState ?? window.history.replaceState;
  }
  originalPushState = null;
  originalReplaceState = null;
  wrappedPushState = null;
  wrappedReplaceState = null;
}

/**
 * React to normal and SPA navigation without polling the page at high
 * frequency. All extension consumers share one event set and one low-rate URL
 * fallback. The fallback only compares route state; it never extracts text.
 */
export function installRouteWatcher(
  callback: () => void,
  signal: AbortSignal,
  options: RouteWatcherOptions,
): void {
  const subscriber: RouteSubscriber = {
    callback,
    fallbackIntervalMs: options.fallbackIntervalMs,
  };
  subscribers.add(subscriber);
  installSharedListeners();
  restartFallback();

  signal.addEventListener(
    'abort',
    () => {
      subscribers.delete(subscriber);
      restartFallback();
      removeSharedListenersWhenUnused();
    },
    { once: true },
  );
}
