import { Readability } from '@mozilla/readability';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const STORY_COUNT = 30;
const REQUEST_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url, responseType = 'text') {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Attention-MVP-Check/0.10' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return responseType === 'json' ? response.json() : response.text();
}

async function loadPreviewFunction() {
  const bundled = await build({
    entryPoints: ['src/analyzer/preview.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  const source = bundled.outputFiles[0]?.text;
  if (!source) throw new Error('Preview analyzer bundle is empty');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl).then((module) => module.createHoverPreview);
}

function benchmarkProfile() {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    updatedAt: timestamp,
    interests: [
      {
        id: 'interest-ai-evaluation',
        topic: 'AI evaluation, research methods, and decision making',
        strength: 0.9,
        confidence: 0.9,
        sources: [],
      },
    ],
    goals: [
      {
        id: 'goal-rigorous-ai-work',
        goal: 'Find rigorous and actionable AI research',
        priority: 'high',
        status: 'active',
        confidence: 0.95,
        sources: [],
      },
    ],
    expertise: [
      {
        id: 'expertise-ai',
        topic: 'artificial intelligence',
        level: 'advanced',
        confidence: 0.85,
        basis: [],
        sources: [],
      },
    ],
    contentPreferences: {
      preferredDepth: 'high',
      noveltyPreference: 'high',
      avoidRepetition: true,
      preferredFormats: ['research', 'technical essays'],
      confidence: 0.9,
      sources: [],
    },
    lowValueTopics: [
      {
        id: 'low-ai-basics',
        topic: 'AI basics and generic introductions',
        confidence: 0.9,
        sources: [],
      },
    ],
  };
}

function extractArticle(html, url) {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const document = dom.window.document;
  let article = null;
  try {
    article = new Readability(document.cloneNode(true), {
      charThreshold: 140,
      maxElemsToParse: 50_000,
    }).parse();
  } catch {
    article = null;
  }
  const fallback = document.querySelector('article, main')?.textContent ?? '';
  const text = (article?.textContent || fallback).replace(/\s+/g, ' ').trim();
  return {
    title: article?.title?.trim() || document.title.trim(),
    excerpt:
      article?.excerpt?.replace(/\s+/g, ' ').trim() || text.slice(0, 320),
    wordCount: text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
    method: article?.textContent
      ? 'readability'
      : fallback
        ? 'semantic'
        : 'none',
  };
}

const topIds = await fetchWithTimeout(
  'https://hacker-news.firebaseio.com/v0/topstories.json',
  'json',
);
const candidateItems = await Promise.all(
  topIds
    .slice(0, 70)
    .map((id) =>
      fetchWithTimeout(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        'json',
      ).catch(() => null),
    ),
);
const stories = candidateItems
  .filter(
    (item) =>
      item &&
      typeof item.title === 'string' &&
      typeof item.url === 'string' &&
      /^https?:\/\//i.test(item.url),
  )
  .slice(0, STORY_COUNT);
const createHoverPreview = await loadPreviewFunction();
const profile = benchmarkProfile();

const results = await Promise.all(
  stories.map(async (story, index) => {
    const preview = await createHoverPreview(
      {
        type: 'ATTENTION_PREVIEW/REQUEST',
        url: story.url,
        title: story.title,
        snippet: '',
      },
      profile,
    );
    try {
      const html = await fetchWithTimeout(story.url);
      const extracted = extractArticle(html, story.url);
      return { index, story, preview, extracted, error: null };
    } catch (error) {
      return {
        index,
        story,
        preview,
        extracted: null,
        error: error instanceof Error ? error.message : 'fetch failed',
      };
    }
  }),
);

for (const result of results) {
  const number = String(result.index + 1).padStart(2, '0');
  const extraction = result.extracted
    ? `${result.extracted.method}, ${result.extracted.wordCount} words`
    : `unavailable: ${result.error}`;
  const verdict =
    result.preview.recommendedAction === 'open'
      ? 'READ'
      : result.preview.recommendedAction === 'skip'
        ? 'SKIP'
        : 'UNCLEAR';
  process.stdout.write(
    `[${number}] ${verdict} (${result.preview.confidence}) | ${result.preview.expectedValue} | ${extraction} | ${result.story.title}\n`,
  );
}

const extracted = results.filter(
  (result) => (result.extracted?.wordCount ?? 0) >= 80,
).length;
const verdictCounts = { read: 0, unclear: 0, skip: 0 };
for (const result of results) {
  if (result.preview.recommendedAction === 'open') verdictCounts.read += 1;
  else if (result.preview.recommendedAction === 'skip') verdictCounts.skip += 1;
  else verdictCounts.unclear += 1;
}
process.stdout.write(
  `SUMMARY stories=${results.length} extracted=${extracted} verdicts=${JSON.stringify(verdictCounts)}\n`,
);
