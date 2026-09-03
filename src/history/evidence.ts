export const BROWSER_HISTORY_EVIDENCE_KEY = 'browserHistoryEvidence';
export const BROWSER_HISTORY_SETTINGS_KEY = 'browserHistorySettings';

export type HistoryLookbackDays = 7 | 30 | 90;

export interface HistoryItemInput {
  url?: string;
  title?: string;
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
}

export interface HistoryPageEncounter {
  fingerprint: string;
  visitCount: number;
  typedCount: number;
  lastEncounteredAt: string;
  confidence: number;
}

export interface HistoryTopicSignal {
  topic: string;
  pageCount: number;
  visitCount: number;
  sourceCount: number;
  lastEncounteredAt: string;
  confidence: number;
}

export interface HistorySourceSignal {
  hostname: string;
  pageCount: number;
  visitCount: number;
  typedCount: number;
  lastEncounteredAt: string;
  confidence: number;
}

export interface BrowserHistoryEvidence {
  schemaVersion: 1;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  processedUrlCount: number;
  totalVisitCount: number;
  excludedUrlCount: number;
  pages: HistoryPageEncounter[];
  topics: HistoryTopicSignal[];
  sources: HistorySourceSignal[];
}

export interface BrowserHistorySettings {
  lookbackDays: HistoryLookbackDays;
  lastProcessedAt: string | null;
  processedUrlCount: number;
  totalVisitCount: number;
  excludedUrlCount: number;
  permissionRetained: boolean;
}

export interface CanonicalHistoryPage {
  canonicalUrl: string;
  hostname: string;
  title: string;
}

const MAX_PAGES = 5_000;
const MAX_TOPICS = 120;
const MAX_SOURCES = 120;
const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
]);
const SENSITIVE_QUERY_KEYS = [
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'code',
  'id_token',
  'key',
  'password',
  'secret',
  'session',
  'sessionid',
  'token',
];
const SENSITIVE_PATH_PARTS = [
  'account',
  'auth',
  'billing',
  'checkout',
  'health',
  'login',
  'medical',
  'oauth',
  'patient',
  'payment',
  'pharmacy',
  'sign-in',
  'signin',
];
const SENSITIVE_HOST_PARTS = [
  'gmail.',
  'mail.google.',
  'outlook.',
  'paypal.',
  'protonmail.',
  'stripe.',
  'wise.com',
];
const SENSITIVE_HOST_LABELS = new Set([
  'bank',
  'banking',
  'billing',
  'checkout',
  'health',
  'medical',
  'patient',
  'payments',
  'pharmacy',
  'wallet',
]);
const SENSITIVE_TITLE_PARTS = [
  'bank account',
  'medical record',
  'patient portal',
  'sign in',
  'войти в аккаунт',
  'медицинск',
  'банковск',
];
const SEARCH_HOSTS = new Set([
  'bing.com',
  'duckduckgo.com',
  'google.com',
  'search.yahoo.com',
  'yandex.com',
  'yandex.ru',
]);
const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'article',
  'before',
  'blog',
  'from',
  'have',
  'home',
  'into',
  'just',
  'more',
  'most',
  'news',
  'page',
  'post',
  'read',
  'that',
  'the',
  'their',
  'this',
  'with',
  'your',
  'для',
  'или',
  'как',
  'материал',
  'это',
  'что',
  'этот',
  'eine',
  'einer',
  'dies',
  'sobre',
  'esta',
  'este',
  'avec',
  'dans',
  'pour',
  'cette',
  'questo',
  'della',
]);

function isPrivateHost(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.local') || value === '::1') {
    return true;
  }
  if (/^(?:127|10)\./.test(value) || /^169\.254\./.test(value)) return true;
  const match = value.match(/^172\.(\d{1,3})\./);
  if (match?.[1] && Number(match[1]) >= 16 && Number(match[1]) <= 31) {
    return true;
  }
  if (/^192\.168\./.test(value) || /^(?:fc|fd)[0-9a-f]{2}:/i.test(value)) {
    return true;
  }
  return false;
}

function looksLikeSearchPage(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return (
    SEARCH_HOSTS.has(host) &&
    (url.pathname === '/search' || url.searchParams.has('q'))
  );
}

function looksLikeSensitiveHost(hostname: string): boolean {
  if (
    SENSITIVE_HOST_PARTS.some((part) =>
      part.endsWith('.')
        ? hostname.includes(part)
        : hostname === part || hostname.endsWith(`.${part}`),
    )
  ) {
    return true;
  }
  return hostname
    .split('.')
    .some((label) => SENSITIVE_HOST_LABELS.has(label.toLowerCase()));
}

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function canonicalizeHistoryPage(
  rawUrl: string,
  title = '',
): CanonicalHistoryPage | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const lowerTitle = title.toLocaleLowerCase();
  const lowerPath = safelyDecode(url.pathname).toLocaleLowerCase();
  if (
    !hostname ||
    url.username ||
    url.password ||
    isPrivateHost(hostname) ||
    looksLikeSensitiveHost(hostname) ||
    SENSITIVE_PATH_PARTS.some((part) =>
      lowerPath.split('/').some((segment) => segment === part),
    ) ||
    SENSITIVE_TITLE_PARTS.some((part) => lowerTitle.includes(part)) ||
    looksLikeSearchPage(url) ||
    [...url.searchParams.keys()].some((key) =>
      SENSITIVE_QUERY_KEYS.some((part) => {
        const normalized = key.toLowerCase();
        return normalized === part || normalized.endsWith(`_${part}`);
      }),
    )
  ) {
    return null;
  }
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith('utm_') ||
      TRACKING_PARAMETERS.has(normalizedKey)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.hostname = hostname;
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return { canonicalUrl: url.toString(), hostname, title };
}

export async function fingerprintHistoryUrl(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function topicTokens(page: CanonicalHistoryPage): string[] {
  const pathname = safelyDecode(new URL(page.canonicalUrl).pathname)
    .replace(/[-_]+/g, ' ')
    .replace(/\b(?:html?|php|aspx?)\b/giu, ' ');
  const hostTokens = new Set(page.hostname.split('.'));
  return [
    ...new Set(
      `${page.title} ${pathname}`
        .toLocaleLowerCase()
        .match(/[\p{L}][\p{L}\p{N}]{2,39}/gu) ?? [],
    ),
  ]
    .filter((token) => !STOP_WORDS.has(token) && !hostTokens.has(token))
    .slice(0, 12);
}

function boundedCount(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0
    ? Math.round(Number(value))
    : fallback;
}

export async function aggregateBrowserHistory(
  items: HistoryItemInput[],
  lookbackDays: HistoryLookbackDays,
  now = new Date(),
): Promise<BrowserHistoryEvidence> {
  const end = now.getTime();
  const start = end - lookbackDays * 86_400_000;
  const accepted = new Map<
    string,
    CanonicalHistoryPage & {
      visitCount: number;
      typedCount: number;
      lastVisitTime: number;
    }
  >();
  let excludedUrlCount = 0;

  for (const item of items) {
    if (!item.url || (item.lastVisitTime ?? end) < start) continue;
    const page = canonicalizeHistoryPage(item.url, item.title ?? '');
    if (!page) {
      excludedUrlCount += 1;
      continue;
    }
    const current = accepted.get(page.canonicalUrl);
    const visitCount = boundedCount(item.visitCount, 1);
    const typedCount = boundedCount(item.typedCount, 0);
    const lastVisitTime = Math.min(end, item.lastVisitTime ?? end);
    accepted.set(page.canonicalUrl, {
      ...page,
      visitCount: (current?.visitCount ?? 0) + visitCount,
      typedCount: (current?.typedCount ?? 0) + typedCount,
      lastVisitTime: Math.max(current?.lastVisitTime ?? 0, lastVisitTime),
    });
  }

  const topicMap = new Map<
    string,
    { pages: Set<string>; sources: Set<string>; visits: number; last: number }
  >();
  const sourceMap = new Map<
    string,
    { pages: number; visits: number; typed: number; last: number }
  >();
  const pages: HistoryPageEncounter[] = [];

  for (const page of accepted.values()) {
    const fingerprint = await fingerprintHistoryUrl(page.canonicalUrl);
    const recency = Math.max(
      0,
      1 - (end - page.lastVisitTime) / Math.max(1, end - start),
    );
    pages.push({
      fingerprint,
      visitCount: page.visitCount,
      typedCount: page.typedCount,
      lastEncounteredAt: new Date(page.lastVisitTime).toISOString(),
      confidence: Math.min(
        0.85,
        0.46 + Math.log1p(page.visitCount) * 0.09 + recency * 0.12,
      ),
    });
    const source = sourceMap.get(page.hostname) ?? {
      pages: 0,
      visits: 0,
      typed: 0,
      last: 0,
    };
    source.pages += 1;
    source.visits += page.visitCount;
    source.typed += page.typedCount;
    source.last = Math.max(source.last, page.lastVisitTime);
    sourceMap.set(page.hostname, source);
    for (const topic of topicTokens(page)) {
      const signal = topicMap.get(topic) ?? {
        pages: new Set<string>(),
        sources: new Set<string>(),
        visits: 0,
        last: 0,
      };
      signal.pages.add(fingerprint);
      signal.sources.add(page.hostname);
      signal.visits += page.visitCount;
      signal.last = Math.max(signal.last, page.lastVisitTime);
      topicMap.set(topic, signal);
    }
  }

  const topics = [...topicMap.entries()]
    .filter(([, value]) => value.pages.size >= 2)
    .map(([topic, value]): HistoryTopicSignal => ({
      topic,
      pageCount: value.pages.size,
      visitCount: value.visits,
      sourceCount: value.sources.size,
      lastEncounteredAt: new Date(value.last).toISOString(),
      confidence: Math.min(
        0.45,
        0.16 +
          Math.log1p(value.pages.size) * 0.08 +
          Math.log1p(value.sources.size) * 0.04,
      ),
    }))
    .sort(
      (left, right) =>
        right.confidence * right.pageCount - left.confidence * left.pageCount,
    )
    .slice(0, MAX_TOPICS);
  const sources = [...sourceMap.entries()]
    .filter(([, value]) => value.pages >= 2 || value.visits >= 3)
    .map(([hostname, value]): HistorySourceSignal => ({
      hostname,
      pageCount: value.pages,
      visitCount: value.visits,
      typedCount: value.typed,
      lastEncounteredAt: new Date(value.last).toISOString(),
      confidence: Math.min(
        0.45,
        0.14 + Math.log1p(value.pages) * 0.07 + Math.log1p(value.typed) * 0.035,
      ),
    }))
    .sort(
      (left, right) =>
        right.confidence * right.pageCount - left.confidence * left.pageCount,
    )
    .slice(0, MAX_SOURCES);
  const totalVisitCount = [...accepted.values()].reduce(
    (sum, item) => sum + item.visitCount,
    0,
  );

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    periodStart: new Date(start).toISOString(),
    periodEnd: now.toISOString(),
    processedUrlCount: accepted.size,
    totalVisitCount,
    excludedUrlCount,
    pages: pages
      .sort((left, right) =>
        right.lastEncounteredAt.localeCompare(left.lastEncounteredAt),
      )
      .slice(0, MAX_PAGES),
    topics,
    sources,
  };
}

export function isHistoryLookbackDays(
  value: unknown,
): value is HistoryLookbackDays {
  return value === 7 || value === 30 || value === 90;
}

export function isBrowserHistoryEvidence(
  value: unknown,
): value is BrowserHistoryEvidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BrowserHistoryEvidence>;
  return (
    item.schemaVersion === 1 &&
    typeof item.generatedAt === 'string' &&
    typeof item.processedUrlCount === 'number' &&
    Array.isArray(item.pages) &&
    Array.isArray(item.topics) &&
    Array.isArray(item.sources)
  );
}
