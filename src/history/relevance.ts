import { textMatchScore } from '../analyzer/text-match';
import { selectRelevantProfileContext } from '../profile/relevance';
import type { PersonalProfile } from '../profile/schema';
import type {
  AnalysisContext,
  PageCapture,
  PersonalizationSignal,
  RelevantHistoryEvidence,
  RelevantProfileContext,
} from '../shared/types';
import type { ReadwiseEvidence } from '../readwise/evidence';
import { selectRelevantReadwiseEvidence } from '../readwise/relevance';
import type { ObsidianIndex } from '../obsidian/types';
import { selectRelevantObsidianEvidence } from '../obsidian/relevance';
import type { NotionIndex } from '../notion/types';
import { selectRelevantNotionEvidence } from '../notion/relevance';
import { type BrowserHistoryEvidence } from './evidence';
import {
  buildMaterialFeatures,
  type MaterialFeatures,
} from '../analyzer/material-features';
import { selectRelevantClaimMemoryEvidence } from '../novelty/claim-memory';
import type { NovelPassageFeedbackRecord } from '../novelty/feedback';
import { mergeUnifiedLocalEvidence } from '../evidence/unified-evidence';
import { scenarioSignalWeight } from '../scenario/signal-weights';
import {
  hasRelevantLeisurePreference,
  relaxHistoryRankMultiplier,
} from '../scenario/relax-history';

const HETEROGENEOUS_SOURCE_ROOTS = [
  'youtube.com',
  'reddit.com',
  'medium.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
] as const;

function isHeterogeneousSource(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase();
  if (normalized === 'substack.com') return true;
  return HETEROGENEOUS_SOURCE_ROOTS.some(
    (root) => normalized === root || normalized.endsWith(`.${root}`),
  );
}

export async function selectRelevantHistoryEvidence(
  evidence: BrowserHistoryEvidence | null,
  material: PageCapture,
  suppliedFeatures?: MaterialFeatures,
): Promise<RelevantHistoryEvidence | null> {
  if (!evidence) return null;
  const features = suppliedFeatures ?? (await buildMaterialFeatures(material));
  const canonical = features.canonicalPage;
  if (!canonical) return null;
  const encountered = evidence.pages.find(
    (page) => page.fingerprint === features.urlFingerprint,
  );
  const text = features.matchingText;
  const topics = evidence.topics
    .map((topic) => ({
      ...topic,
      match: textMatchScore(topic.topic, text),
    }))
    .filter((topic) => topic.match >= 0.45)
    .sort(
      (left, right) =>
        right.match * right.confidence - left.match * left.confidence,
    )
    .slice(0, 3);
  const source = evidence.sources.find(
    (item) => item.hostname === canonical.hostname,
  );
  if (!encountered && topics.length === 0 && !source) return null;
  const topicFamiliarity = Math.min(
    0.45,
    topics.reduce(
      (maximum, topic) => Math.max(maximum, topic.match * topic.confidence),
      0,
    ),
  );
  const interestConfidence = Math.min(
    0.45,
    Math.max(topicFamiliarity, source?.confidence ?? 0),
  );
  return {
    exactPageEncountered: Boolean(encountered),
    encounteredProbability: encountered?.confidence ?? 0,
    topicFamiliarity,
    interestConfidence,
    matchingTopics: topics.map((topic) => topic.topic),
    matchingSources: source ? [source.hostname] : [],
    evidenceUpdatedAt: evidence.generatedAt,
  };
}

function historySignals(
  history: RelevantHistoryEvidence,
): PersonalizationSignal[] {
  const signals: PersonalizationSignal[] = history.matchingTopics.map(
    (topic, index) => ({
      id: `historyTopic:${topic}`,
      profileEntryId: null,
      kind: 'historyTopic',
      effect: 'positive',
      label: topic,
      explanation: `Тема «${topic}» регулярно встречалась в недавней истории. Это слабый сигнал интереса, а не подтверждение знания.`,
      // Topic familiarity already combines repetition confidence with the
      // match to this concrete material. Keep it separate from source
      // confidence so a visit to youtube.com cannot boost every video.
      confidence: Math.min(0.45, history.topicFamiliarity),
      matchScore: Math.min(
        1,
        Math.max(0.45, history.topicFamiliarity / 0.45 - index * 0.08),
      ),
    }),
  );
  for (const source of history.matchingSources) {
    // Aggregator/platform domains contain unrelated material. Knowing that a
    // user visits YouTube or Reddit is not evidence that this particular item
    // matches their taste. Topic history still remains available.
    if (isHeterogeneousSource(source)) continue;
    signals.push({
      id: `historySource:${source}`,
      profileEntryId: null,
      kind: 'historySource',
      effect: 'positive',
      label: source,
      explanation: `Вы раньше выбирали материалы с ${source}. Это слабый сигнал предпочтения источника.`,
      confidence: Math.min(0.45, history.interestConfidence),
      matchScore: 1,
    });
  }
  return signals;
}

export async function selectRelevantPersonalContext(
  profile: PersonalProfile | null,
  historyEvidence: BrowserHistoryEvidence | null,
  readwiseEvidence: ReadwiseEvidence | null,
  obsidianIndex: ObsidianIndex | null,
  notionIndex: NotionIndex | null,
  material: PageCapture,
  context: AnalysisContext,
  claimMemoryRecords: NovelPassageFeedbackRecord[] = [],
  suppliedFeatures?: MaterialFeatures,
): Promise<RelevantProfileContext | null> {
  const features = suppliedFeatures ?? (await buildMaterialFeatures(material));
  const profileContext = selectRelevantProfileContext(
    profile,
    material,
    context,
    features,
  );
  const [history, readwise, notion] = await Promise.all([
    selectRelevantHistoryEvidence(historyEvidence, material, features),
    selectRelevantReadwiseEvidence(readwiseEvidence, material, features),
    selectRelevantNotionEvidence(notionIndex, material, features),
  ]);
  const obsidian = selectRelevantObsidianEvidence(
    obsidianIndex,
    material,
    Date.now(),
    features,
  );
  const claimMemory = selectRelevantClaimMemoryEvidence(
    claimMemoryRecords,
    features,
  );
  const unifiedLocalEvidence = mergeUnifiedLocalEvidence({
    readwise: readwise ?? undefined,
    obsidian: obsidian ?? undefined,
    notion: notion ?? undefined,
  });
  if (
    !profileContext &&
    !history &&
    !readwise &&
    !obsidian &&
    !notion &&
    !claimMemory
  ) {
    return null;
  }
  const explicitSignals = profileContext?.signals ?? [];
  const weakHistorySignals = history ? historySignals(history) : [];
  const candidateSignals = [...explicitSignals, ...weakHistorySignals];
  const useRelaxHistoryFallback =
    context.scenario === 'relax' &&
    !hasRelevantLeisurePreference(candidateSignals);
  const weightedSignals = candidateSignals
    .map((signal) => ({
      signal,
      rank:
        signal.matchScore *
        signal.confidence *
        scenarioSignalWeight(context.scenario, signal.kind) *
        (useRelaxHistoryFallback
          ? relaxHistoryRankMultiplier(signal, candidateSignals)
          : 1),
    }))
    .sort((left, right) => right.rank - left.rank)
    .map(({ signal }) => signal)
    .slice(0, 6);
  return {
    profileUpdatedAt:
      profileContext?.profileUpdatedAt ??
      obsidian?.evidenceUpdatedAt ??
      notion?.evidenceUpdatedAt ??
      readwise?.evidenceUpdatedAt ??
      history?.evidenceUpdatedAt ??
      new Date(0).toISOString(),
    signals: weightedSignals,
    knowledgeSignals: profileContext?.knowledgeSignals ?? [],
    ...(history ? { historyEvidence: history } : {}),
    ...(readwise ? { readwiseEvidence: readwise } : {}),
    ...(obsidian ? { obsidianEvidence: obsidian } : {}),
    ...(notion ? { notionEvidence: notion } : {}),
    ...(claimMemory ? { claimMemoryEvidence: claimMemory } : {}),
    ...(unifiedLocalEvidence ? { unifiedLocalEvidence } : {}),
  };
}
