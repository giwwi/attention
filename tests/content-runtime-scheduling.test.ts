import { afterEach, describe, expect, it, vi } from 'vitest';
import { installRouteWatcher } from '../src/content/route-watcher';
import { subscribeToScroll } from '../src/content/scroll-hub';

describe('content runtime scheduling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares one frame-throttled scroll path across consumers', () => {
    let releaseFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      releaseFrame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const first = vi.fn();
    const second = vi.fn();
    const firstController = new AbortController();
    const secondController = new AbortController();
    subscribeToScroll(first, firstController.signal);
    subscribeToScroll(second, secondController.signal);

    const nestedScroller = document.createElement('div');
    document.body.append(nestedScroller);
    nestedScroller.dispatchEvent(new Event('scroll'));
    nestedScroller.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    const frameCallback = releaseFrame as FrameRequestCallback | null;
    frameCallback?.(16);
    window.dispatchEvent(new Event('scroll'));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);

    firstController.abort();
    secondController.abort();
    frameCallback?.(32);
    window.dispatchEvent(new Event('scroll'));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('uses route events plus one settled check instead of rapid polling', async () => {
    vi.useFakeTimers();
    const initialUrl = window.location.href;
    const callback = vi.fn();
    const controller = new AbortController();
    installRouteWatcher(callback, controller.signal, {
      fallbackIntervalMs: 10_000,
    });

    window.history.pushState({}, '', '/spa/article');
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_499);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callback).toHaveBeenCalledTimes(2);
    window.history.replaceState({}, '', initialUrl);
  });
});
