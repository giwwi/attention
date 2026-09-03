import { describe, expect, it } from 'vitest';
import {
  aggregateBrowserHistory,
  canonicalizeHistoryPage,
} from '../src/history/evidence';
import {
  selectRelevantHistoryEvidence,
  selectRelevantPersonalContext,
} from '../src/history/relevance';
import { LocalAnalyzer } from '../src/analyzer/local-analyzer';
import { createHoverPreview } from '../src/analyzer/preview';
import { createEmptyProfile } from '../src/profile/schema';
import type { PageCapture } from '../src/shared/types';

function material(url: string): PageCapture {
  return {
    title: 'Practical AI agents architecture guide',
    url,
    content: 'AI agents architecture and evaluation methods. '.repeat(120),
    excerpt: 'A practical guide to AI agents architecture.',
    byline: null,
    siteName: 'Example',
    publishedTime: null,
    language: 'en',
    wordCount: 800,
    readingTimeMinutes: 4,
    headings: ['Agent architecture', 'Evaluation'],
    isArticle: true,
    extractionMethod: 'readability',
    capturedAt: '2026-08-27T10:00:00.000Z',
  };
}

describe('browser history evidence', () => {
  it('filters sensitive, local, auth and search URLs before aggregation', () => {
    expect(canonicalizeHistoryPage('http://localhost:3000/private')).toBeNull();
    expect(canonicalizeHistoryPage('https://gmail.com/mail/u/0')).toBeNull();
    expect(
      canonicalizeHistoryPage('https://bank.example.com/dashboard'),
    ).toBeNull();
    expect(
      canonicalizeHistoryPage('https://patient.example.org/appointments'),
    ).toBeNull();
    expect(canonicalizeHistoryPage('https://example.com/login')).toBeNull();
    expect(
      canonicalizeHistoryPage('https://example.com/article?access_token=x'),
    ).toBeNull();
    expect(
      canonicalizeHistoryPage('https://google.com/search?q=private+query'),
    ).toBeNull();
    expect(
      canonicalizeHistoryPage(
        'https://www.example.com/article/?UTM_source=test&FBCLID=1#section',
      )?.canonicalUrl,
    ).toBe('https://example.com/article');
  });

  it('stores fingerprints and aggregates only repeated topics and sources', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const evidence = await aggregateBrowserHistory(
      [
        {
          url: 'https://example.com/ai-agents-introduction',
          title: 'AI agents architecture introduction',
          visitCount: 3,
          typedCount: 1,
          lastVisitTime: now.getTime() - 1_000,
        },
        {
          url: 'https://example.com/ai-agents-evaluation',
          title: 'AI agents evaluation methods',
          visitCount: 2,
          lastVisitTime: now.getTime() - 2_000,
        },
        {
          url: 'https://gmail.com/mail/u/0/#inbox',
          title: 'Inbox',
          visitCount: 20,
          lastVisitTime: now.getTime(),
        },
      ],
      30,
      now,
    );

    expect(evidence.processedUrlCount).toBe(2);
    expect(evidence.excludedUrlCount).toBe(1);
    expect(evidence.pages).toHaveLength(2);
    expect(evidence.pages[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain('ai-agents-introduction');
    expect(JSON.stringify(evidence)).not.toContain('Inbox');
    expect(evidence.topics.some((topic) => topic.topic === 'agents')).toBe(
      true,
    );
    expect(evidence.topics.every((topic) => topic.confidence <= 0.45)).toBe(
      true,
    );
    expect(evidence.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hostname: 'example.com', pageCount: 2 }),
      ]),
    );
  });

  it('treats exact encounter and repeated topics as weak evidence, not knowledge', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const url = 'https://example.com/ai-agents-introduction';
    const evidence = await aggregateBrowserHistory(
      [
        {
          url,
          title: 'Practical AI agents architecture guide',
          visitCount: 2,
          lastVisitTime: now.getTime(),
        },
        {
          url: 'https://another.example/ai-agents-evaluation',
          title: 'AI agents architecture evaluation',
          visitCount: 2,
          lastVisitTime: now.getTime(),
        },
      ],
      30,
      now,
    );
    const relevant = await selectRelevantHistoryEvidence(
      evidence,
      material(`${url}?utm_source=newsletter#intro`),
    );

    expect(relevant?.exactPageEncountered).toBe(true);
    expect(relevant?.encounteredProbability).toBeLessThanOrEqual(0.85);
    expect(relevant?.interestConfidence).toBeLessThanOrEqual(0.45);
    expect(relevant?.matchingTopics).toContain('agents');
  });

  it('keeps explicit profile signals ahead of bounded history signals', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const evidence = await aggregateBrowserHistory(
      [
        {
          url: 'https://example.com/ai-agents-introduction',
          title: 'Practical AI agents architecture guide',
          visitCount: 4,
          lastVisitTime: now.getTime(),
        },
        {
          url: 'https://example.com/ai-agents-evaluation',
          title: 'AI agents architecture evaluation',
          visitCount: 3,
          lastVisitTime: now.getTime(),
        },
      ],
      30,
      now,
    );
    const profile = createEmptyProfile(now);
    profile.interests.push({
      id: 'interest:agents',
      topic: 'AI agents architecture',
      strength: 1,
      confidence: 0.9,
      sources: [],
    });
    const relevant = await selectRelevantPersonalContext(
      profile,
      evidence,
      null,
      null,
      null,
      material('https://example.com/ai-agents-introduction'),
      { scenario: 'work', intent: '', availableMinutes: 15 },
    );

    expect(relevant?.signals[0]?.kind).toBe('interest');
    expect(
      relevant?.signals
        .filter((signal) => signal.kind.startsWith('history'))
        .every((signal) => signal.confidence <= 0.45),
    ).toBe(true);
    expect(relevant?.knowledgeSignals).toEqual([]);
  });

  it('changes local relevance and novelty only conservatively', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const target = material('https://example.com/ai-agents-introduction');
    const evidence = await aggregateBrowserHistory(
      [
        {
          url: target.url,
          title: target.title,
          visitCount: 5,
          lastVisitTime: now.getTime(),
        },
        {
          url: 'https://example.com/ai-agents-evaluation',
          title: 'AI agents architecture evaluation',
          visitCount: 4,
          lastVisitTime: now.getTime(),
        },
      ],
      30,
      now,
    );
    const context = {
      scenario: 'work' as const,
      intent: '',
      availableMinutes: 15 as const,
    };
    const relevant = await selectRelevantPersonalContext(
      null,
      evidence,
      null,
      null,
      null,
      target,
      context,
    );
    const analyzer = new LocalAnalyzer();
    const baseline = await analyzer.analyze(target, context, null);
    const withHistory = await analyzer.analyze(target, context, relevant);

    expect(
      withHistory.components.relevance - baseline.components.relevance,
    ).toBeLessThanOrEqual(10);
    expect(
      Math.abs(withHistory.components.novelty - baseline.components.novelty),
    ).toBeLessThanOrEqual(8);
    expect(
      withHistory.insights?.keyClaims.some(
        (claim) => claim.novelty === 'known',
      ),
    ).toBe(false);
  });

  it('uses repeated matching choices as the fallback taste model for Relax', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const evidence = await aggregateBrowserHistory(
      Array.from({ length: 5 }, (_, index) => ({
        url: `https://youtube.com/watch?v=medieval-comedy-${index}`,
        title: `Medieval comedy game adventure episode ${index + 1}`,
        visitCount: 2,
        lastVisitTime: now.getTime() - index * 1_000,
      })),
      30,
      now,
    );
    const relaxContext = {
      scenario: 'relax' as const,
      intent: '',
      availableMinutes: 15 as const,
      relaxIntent: 'funny' as const,
      desiredEffort: 'low' as const,
    };
    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://youtube.com/watch?v=new-medieval-comedy',
        title: 'A funny medieval comedy game adventure',
        snippet: 'A short humorous episode.',
      },
      createEmptyProfile(now),
      undefined,
      relaxContext,
      evidence,
    );
    const relevant = await selectRelevantPersonalContext(
      createEmptyProfile(now),
      evidence,
      null,
      null,
      null,
      {
        ...material('https://youtube.com/watch?v=new-medieval-comedy'),
        title: 'A funny medieval comedy game adventure',
        content: 'A short humorous medieval comedy episode. '.repeat(120),
        excerpt: 'A short humorous episode.',
      },
      relaxContext,
    );

    expect(preview.recommendedAction).toBe('open');
    expect(preview.reason).toContain('недавней истории');
    expect(preview.expectedValue).toBe('Похоже на подходящий вам досуг');
    expect(relevant?.signals[0]?.kind).toBe('historyTopic');
  });

  it('does not treat a generic platform visit as a preference for every item', async () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const evidence = await aggregateBrowserHistory(
      Array.from({ length: 5 }, (_, index) => ({
        url: `https://youtube.com/watch?v=technical-${index}`,
        title: `Database performance lecture part ${index + 1}`,
        visitCount: 2,
        lastVisitTime: now.getTime() - index * 1_000,
      })),
      30,
      now,
    );
    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: 'https://youtube.com/watch?v=dance',
        title: 'Celebrity dance gossip compilation',
        snippet: 'Entertainment news and dance clips.',
      },
      createEmptyProfile(now),
      undefined,
      {
        scenario: 'relax',
        intent: '',
        availableMinutes: 15,
        relaxIntent: 'funny',
        desiredEffort: 'low',
      },
      evidence,
    );

    expect(preview.recommendedAction).toBe('maybe');
    expect(preview.reason).toContain('недостаточно данных');
  });
});
