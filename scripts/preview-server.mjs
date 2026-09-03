import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const port = 4173;
const previewManifest = JSON.parse(
  await readFile('public/manifest.json', 'utf8'),
);
const sampleCapture = {
  title: 'Why most of what we read never changes our decisions',
  url: 'https://example.com/attention-and-decisions',
  content:
    'We encounter more material than we can read. The value of an article depends not only on its quality, but also on what the reader already knows and what they are trying to accomplish now.',
  excerpt:
    'A practical framework for separating useful information from familiar repetition.',
  byline: 'Anna Petrova',
  siteName: 'Research Notes',
  publishedTime: '2026-08-20T09:00:00Z',
  language: 'en',
  wordCount: 1_840,
  readingTimeMinutes: 9,
  headings: [
    'Why attention became scarce',
    'Familiarity is not knowledge',
    'Estimating marginal information value',
  ],
  isArticle: true,
  extractionMethod: 'readability',
  capturedAt: new Date().toISOString(),
};

const previewTime = new Date().toISOString();
const previewSource = {
  source: 'manual',
  importedAt: previewTime,
  generatedAt: null,
};
const sampleProfile = {
  schemaVersion: '1.0',
  updatedAt: previewTime,
  interests: [
    {
      id: 'preview-interest-attention',
      topic: 'attention allocation',
      strength: 0.9,
      confidence: 0.9,
      sources: [previewSource],
    },
  ],
  goals: [
    {
      id: 'preview-goal-decisions',
      goal: 'make better decisions about what to read',
      priority: 'high',
      status: 'active',
      confidence: 0.95,
      sources: [previewSource],
    },
  ],
  expertise: [],
  contentPreferences: {
    preferredDepth: 'high',
    noveltyPreference: 'high',
    avoidRepetition: true,
    preferredFormats: ['research'],
    confidence: 0.85,
    sources: [previewSource],
  },
  lowValueTopics: [],
};
const sampleAttentionSession = {
  id: 'preview-attention-session',
  url: sampleCapture.url,
  title: sampleCapture.title,
  decision: 'read',
  expected: {
    analyzerId: 'local-heuristic-v2',
    recommendedAction: 'read',
    expectedValue: 'The article may improve future reading decisions.',
    confidence: 0.78,
    profileSignalIds: ['preview-goal-decisions'],
    predictedUtility: 82,
    components: {
      relevance: 91,
      novelty: 74,
      actionability: 63,
      quality: 80,
    },
  },
  estimatedReadingSeconds: sampleCapture.readingTimeMinutes * 60,
  startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  updatedAt: previewTime,
  endedAt: previewTime,
  visibleSeconds: 120,
  maxScrollDepth: 75,
  sampledForOutcome: true,
  promptShownCount: 0,
  outcome: null,
  outcomeReason: null,
  outcomeAt: null,
};
const sampleSavedMaterials = [
  {
    capture: sampleCapture,
    savedAt: previewTime,
  },
  {
    capture: {
      ...sampleCapture,
      title: 'Как измерять ценность информации до чтения',
      url: 'https://example.com/information-value',
      siteName: 'Decision Lab',
      readingTimeMinutes: 14,
      capturedAt: previewTime,
    },
    savedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const mockScript = `<script>
const previewHasProfile = location.pathname === '/profile' || location.pathname === '/outcome' || location.pathname === '/ai';
const storageData = previewHasProfile
  ? {
      profileOnboardingComplete: true,
      personalProfile: ${JSON.stringify(sampleProfile)},
      ...(location.pathname === '/outcome'
        ? { attentionSessions: [${JSON.stringify(sampleAttentionSession)}] }
        : {}),
      ...(location.pathname === '/ai'
        ? { aiAnalyzerSettings: {
            provider: 'vercel-ai-gateway',
            model: 'google/gemini-2.5-flash-lite',
            apiKey: 'preview-key-not-used',
            updatedAt: new Date().toISOString(),
          } }
        : {}),
    }
  : location.pathname === '/saved'
    ? {
        profileOnboardingComplete: true,
        savedMaterials: ${JSON.stringify(sampleSavedMaterials)},
      }
    : {};
globalThis.chrome = {
  runtime: {
    id: 'ui-preview',
    getManifest: () => ({ version: ${JSON.stringify(previewManifest.version)} }),
  },
  tabs: {
    query: async () => [{ id: 1 }],
    sendMessage: async (_tabId, message) =>
      message?.type === 'PAGE_CAPTURE/SCROLL_TO_HEADING'
        ? { ok: true, found: true }
        : { ok: true, capture: ${JSON.stringify(sampleCapture)} },
    create: async ({ url }) => ({ id: 2, url }),
  },
  scripting: { executeScript: async () => [] },
  storage: { local: {
    QUOTA_BYTES: 10485760,
    setAccessLevel: async () => undefined,
    get: async (keys) => {
      if (keys == null) return { ...storageData };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, storageData[key]]));
    },
    set: async (values) => Object.assign(storageData, values),
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storageData[key];
    },
    getBytesInUse: async () => 0,
  } },
};
</script>`;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const hoverPreviewPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>The mind virus: Why you should care whether you read AI-generated content | Here Is Your Brain</title>
    <meta property="og:title" content="The mind virus: Why you should care whether you read AI-generated content" />
    <link rel="canonical" href="https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus" />
    <style>
      body { max-width: 760px; margin: 60px auto; padding: 0 24px; color: #222; background: #f7f5ef; font: 16px/1.5 system-ui, sans-serif; }
      h1 { font: 700 42px/1.1 Georgia, serif; }
      li { margin: 22px 0; }
      a { color: #164f3d; font: 700 21px/1.25 Georgia, serif; }
    </style>
    <script>
      const runtimeListeners = new Set();
      globalThis.chrome = {
        runtime: {
          sendMessage: async (message) => {
            if (message.type === 'ATTENTION_PREVIEW/REQUEST') {
              const full = true;
              return {
                ok: true,
                preview: {
                  utilityScore: full ? 79 : null,
                  recommendedAction: 'open',
                  reason: 'Strong match with your current goal.',
                  expectedValue: 'Several new arguments and practical takeaways.',
                  risk: 'Some introductory context may already be familiar.',
                  confidence: full ? 'high' : 'medium',
                  source: full ? 'full-analysis' : 'title-preview',
                  signalIds: ['goal:preview'],
                  calibrationSampleSize: 3,
                  ...(full ? {
                    components: { relevance: 91, novelty: 74, actionability: 68, quality: 82 },
                    estimatedUsefulMinutes: 7,
                  } : {}),
                },
              };
            }
            if (message.type === 'ATTENTION_SESSION/AUTO_START') {
              return {
                ok: true,
                session: {
                  sessionId: 'hover-preview-session',
                  url: location.href,
                  decision: 'read',
                  estimatedReadingSeconds: 60,
                  sampledForOutcome: true,
                  promptShownCount: 0,
                },
              };
            }
            if (message.type === 'ATTENTION_OUTCOME/SUBMIT') return { ok: true };
            return undefined;
          },
          onMessage: {
            addListener: (listener) => runtimeListeners.add(listener),
            removeListener: (listener) => runtimeListeners.delete(listener),
          },
        },
      };
    </script>
  </head>
  <body>
    <main>
      <section data-testid="post-header">
        <h1>The mind virus: Why you should care whether you read AI-generated content</h1>
        <p>Hover over the main title for about half a second.</p>
      </section>
      <article data-testid="post-body">
        <p>${'A substantive paragraph about evaluation, novelty, evidence, practical application, and the quality of an argument. '.repeat(24)}</p>
        <h1><a href="https://hereisyourbrain.substack.com/p/ai-generated-content-mind-virus#the-mind-virus">The mind virus</a></h1>
        <p>This is the first section inside the article body.</p>
      </article>
    </main>
    <ul>
      <li><a href="https://example.com/evaluation">A rigorous framework for evaluating AI systems</a><p>New research methods and practical benchmarks.</p></li>
      <li><a href="https://example.com/basics">AI basics you already know</a><p>A familiar introduction with little new evidence.</p></li>
    </ul>
    <script src="/content.js"></script>
  </body>
</html>`;

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (
      requestUrl.pathname === '/hover' ||
      requestUrl.pathname.startsWith('/home/post/')
    ) {
      response.writeHead(200, { 'Content-Type': contentTypes['.html'] });
      response.end(hoverPreviewPage);
      return;
    }
    const pathname =
      requestUrl.pathname === '/' ||
      requestUrl.pathname === '/profile' ||
      requestUrl.pathname === '/outcome' ||
      requestUrl.pathname === '/ai' ||
      requestUrl.pathname === '/saved'
        ? '/popup.html'
        : requestUrl.pathname;
    const filePath = join('dist', pathname.replace(/^\//, ''));
    let body = await readFile(filePath);
    if (pathname === '/popup.html') {
      body = Buffer.from(
        body
          .toString()
          .replace(
            '<script type="module"',
            `${mockScript}<script type="module"`,
          ),
      );
    }
    response.writeHead(200, {
      'Content-Type':
        contentTypes[extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `Attention preview: http://127.0.0.1:${port} (/profile, /outcome, /saved, /ai and /hover)\n`,
  );
});
