import { describe, expect, it } from 'vitest';
import { messageSenderMatchesPage } from '../src/background/message-sender';

describe('page message sender validation', () => {
  it('accepts an SPA article when the document URL is stale but the tab URL is current', () => {
    expect(
      messageSenderMatchesPage(
        {
          frameId: 0,
          url: 'https://substack.com/',
          tab: {
            id: 42,
            url: 'https://substack.com/home/post/p-211734563',
          },
        },
        'https://substack.com/home/post/p-211734563',
      ),
    ).toBe(true);
  });

  it('continues to accept a normally loaded article document', () => {
    expect(
      messageSenderMatchesPage(
        {
          frameId: 0,
          url: 'https://www.lesswrong.com/posts/example/article-title',
          tab: {
            id: 43,
            url: 'https://www.lesswrong.com/posts/example/article-title',
          },
        },
        'https://www.lesswrong.com/posts/example/article-title#comments',
      ),
    ).toBe(true);
  });

  it('rejects a different current tab URL even if it shares an origin', () => {
    expect(
      messageSenderMatchesPage(
        {
          frameId: 0,
          url: 'https://example.com/feed',
          tab: { id: 44, url: 'https://example.com/article/one' },
        },
        'https://example.com/article/two',
      ),
    ).toBe(false);
  });

  it('rejects subframes and extension-page messages', () => {
    expect(
      messageSenderMatchesPage(
        {
          frameId: 2,
          url: 'https://example.com/article',
          tab: { id: 45, url: 'https://example.com/article' },
        },
        'https://example.com/article',
      ),
    ).toBe(false);
    expect(
      messageSenderMatchesPage(
        { url: 'chrome-extension://extension-id/popup.html' },
        'https://example.com/article',
      ),
    ).toBe(false);
  });
});
