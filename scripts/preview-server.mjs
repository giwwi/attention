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

const demoRuntimeScript = `<script>
  const runtimeListeners = new Set();
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === 'ATTENTION_PREVIEW/REQUEST') {
          const full = Boolean(message.capture);
          const lowValue = String(message.url).includes('ai-news-roundup');
          return {
            ok: true,
            preview: {
              utilityScore: full ? 84 : null,
              recommendedAction: lowValue ? 'skip' : 'open',
              reason: lowValue
                ? 'Mostly familiar news with little direct value for your current goal.'
                : 'Strong match with your goal of making better reading decisions.',
              expectedValue: lowValue
                ? 'A quick recap of stories you have probably already seen.'
                : 'A concrete framework you can apply to your own information diet.',
              risk: lowValue
                ? 'Low novelty and limited practical depth.'
                : 'The evidence comes from a small set of behavioral studies.',
              confidence: full ? 'high' : 'medium',
              source: full ? 'full-analysis' : 'title-preview',
              signalIds: ['goal:reading-decisions'],
              calibrationSampleSize: 8,
              ...(full ? {
                components: {
                  relevance: 93,
                  novelty: 78,
                  actionability: 81,
                  quality: 76,
                },
                estimatedUsefulMinutes: 6,
                insights: {
                  keyClaims: [
                    {
                      claim: 'Reading value depends on the decision a reader needs to make.',
                      type: 'thesis',
                      importance: 'primary',
                      novelty: 'likely-new',
                      knownProbability: 0.18,
                      reason: 'No matching idea appears in the selected personal context.',
                      confidence: 0.82,
                    },
                    {
                      claim: 'Explicit outcomes can calibrate later recommendations.',
                      type: 'conclusion',
                      importance: 'primary',
                      novelty: 'likely-new',
                      knownProbability: 0.24,
                      reason: 'The calibration mechanism is specific to this article.',
                      confidence: 0.76,
                    },
                  ],
                  likelyNewClaims: [
                    'Reading value depends on the decision a reader needs to make.',
                    'Explicit outcomes can calibrate later recommendations.',
                  ],
                  familiarClaims: [],
                  noveltySummary: 'Two central ideas are likely to be new and useful.',
                  noveltyConfidence: 0.78,
                  qualityBreakdown: {
                    evidence: 72,
                    reasoning: 84,
                    specificity: 79,
                    calibration: 68,
                  },
                  qualitySummary: 'Clear reasoning with concrete limitations.',
                  qualityStrengths: ['The proposed feedback loop is testable.'],
                  qualityLimitations: ['Evidence is drawn from a small sample.'],
                  qualityConfidence: 0.75,
                },
              } : {}),
            },
            analysisSource: full ? 'local' : undefined,
            saved: false,
            aiState: 'not-connected',
            readwiseConnected: false,
            novelPassageHighlightsEnabled: false,
          };
        }
        if (message.type === 'ATTENTION_SESSION/AUTO_START') {
          return {
            ok: true,
            session: {
              sessionId: 'demo-session',
              url: location.href,
              decision: 'read',
              estimatedReadingSeconds: 360,
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
</script>`;

const demoFeedPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hacker News</title>
    <style>
      body { margin: 0; color: #000; background: #f6f6ef; font: 14px/1.35 Verdana, Geneva, sans-serif; }
      main { width: min(1120px, 94vw); min-height: 100vh; margin: 8px auto; background: #f6f6ef; }
      header { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; background: #ff6600; }
      .y { display: grid; width: 20px; height: 20px; place-items: center; border: 1px solid #fff; color: #fff; }
      header strong { font-size: 15px; }
      header span { color: #222; }
      ol { margin: 18px 0 0; padding-left: 42px; }
      li { margin: 0 0 11px; padding-left: 3px; color: #828282; }
      a { color: #000; text-decoration: none; font-size: 15px; }
      .domain, .meta { color: #828282; font-size: 10px; }
      .meta { display: block; margin-top: 2px; }
      footer { margin: 26px 0; border-top: 2px solid #ff6600; padding: 18px; text-align: center; color: #828282; font-size: 11px; }
    </style>
    ${demoRuntimeScript}
  </head>
  <body>
    <main>
      <header><span class="y">Y</span><strong>Hacker News</strong><span>new | past | comments | ask | show | jobs | submit</span></header>
      <ol>
        <li><a href="/demo/article/attention-value">A practical framework for deciding what is worth reading</a> <span class="domain">(decisionlab.example)</span><span class="meta">214 points by signal_noise 2 hours ago | 86 comments</span></li>
        <li><a href="/demo/article/ai-news-roundup">This week in AI: another roundup of launches and rumors</a> <span class="domain">(dailyai.example)</span><span class="meta">97 points by recapbot 1 hour ago | 41 comments</span></li>
        <li><a href="/demo/article/local-software">Local-first software and the return of user-owned data</a> <span class="domain">(inkandswitch.example)</span><span class="meta">351 points by malisper 5 hours ago | 129 comments</span></li>
        <li><a href="/demo/article/browser-agents">What browser agents still get wrong about context</a> <span class="domain">(systems.example)</span><span class="meta">168 points by latent_space 3 hours ago | 57 comments</span></li>
        <li><a href="/demo/article/attention-value">The economics of scarce attention</a> <span class="domain">(researchnotes.example)</span><span class="meta">122 points by marginalia 4 hours ago | 33 comments</span></li>
        <li><a href="/demo/article/ai-news-roundup">Twenty productivity tools you should try this month</a> <span class="domain">(toolbox.example)</span><span class="meta">46 points by launchday 38 minutes ago | 19 comments</span></li>
      </ol>
      <footer>Guidelines | FAQ | Lists | API | Security | Legal | Apply to YC</footer>
    </main>
    <script src="/content.js"></script>
  </body>
</html>`;

const demoArticlePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta property="og:title" content="A practical framework for deciding what is worth reading" />
    <link rel="canonical" href="http://127.0.0.1:4173/demo/article/attention-value" />
    <title>A practical framework for deciding what is worth reading</title>
    <style>
      body { margin: 0; color: #202521; background: #f5f2e9; font: 18px/1.62 Georgia, serif; }
      article { max-width: 760px; margin: 0 auto; padding: 58px 28px 120px; }
      .publication { color: #33705a; font: 700 12px/1.2 system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 720px; margin: 16px 0; font-size: 48px; line-height: 1.08; letter-spacing: -.025em; }
      .dek { color: #59615c; font: 20px/1.45 system-ui, sans-serif; }
      .byline { margin: 26px 0 38px; color: #777; font: 13px/1.4 system-ui, sans-serif; }
      h2 { margin-top: 42px; font-size: 28px; }
    </style>
    ${demoRuntimeScript}
  </head>
  <body>
    <article>
      <div class="publication">Decision Lab</div>
      <h1>A practical framework for deciding what is worth reading</h1>
      <p class="dek">Information is abundant. The scarce resource is knowing which material can change the decision in front of you.</p>
      <p class="byline">By Maya Chen · September 3, 2026 · 9 min read</p>
      <p>Most reading tools begin after the decision has already been made. They summarize an article, save it, or make it easier to consume. But the expensive decision comes earlier: whether the article deserves attention at all.</p>
      <h2>Value depends on the reader's next decision</h2>
      <p>The same article can be useful to one person and redundant to another. A useful estimate combines the reader's current goal, prior knowledge, available time, and the quality of the material's reasoning.</p>
      <h2>Close the loop with outcomes</h2>
      <p>A recommendation becomes more useful when it can be compared with what happened afterward. A small explicit signal—whether the material was worth the time—can calibrate later estimates without turning reading into surveillance.</p>
    </article>
    <script src="/content.js"></script>
  </body>
</html>`;

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/demo') {
      response.writeHead(200, { 'Content-Type': contentTypes['.html'] });
      response.end(demoFeedPage);
      return;
    }
    if (requestUrl.pathname.startsWith('/demo/article/')) {
      response.writeHead(200, { 'Content-Type': contentTypes['.html'] });
      response.end(demoArticlePage);
      return;
    }
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
