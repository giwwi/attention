import { privateStorage } from '../vault/storage';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { AI_GATEWAY_SUGGESTED_MODELS } from '../analyzer/settings';
import {
  DISPLAY_REASONS,
  PASSAGE_REJECTIONS,
  RELEVANCE_INPUT_KINDS,
  type AiAnalysisDiagnostic,
  type PassageDisplayTrace,
  type PassageRelevanceInput,
} from './ai-analysis-types';

export const AI_ANALYSIS_DIAGNOSTIC_KEY = 'lastAiAnalysisDiagnostic';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(10_000_000, Math.max(0, Math.trunc(value)))
    : 0;
const probability = (value: unknown): number | null =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? value
    : null;

function safeRelevanceInput(
  input: PassageRelevanceInput,
): PassageRelevanceInput {
  const kind = RELEVANCE_INPUT_KINDS.includes(input.kind)
    ? input.kind
    : 'other';
  const valid =
    kind === 'number' &&
    typeof input.value === 'number' &&
    Number.isFinite(input.value) &&
    input.value >= 0 &&
    input.value <= 100 &&
    (input.scale === 'percent' || (input.scale === 'unit' && input.value <= 1));
  return {
    kind,
    value: valid ? input.value : null,
    scale: valid ? input.scale : 'invalid',
  };
}

export function safeDisplayTrace(
  trace: PassageDisplayTrace,
): PassageDisplayTrace {
  return {
    reason: DISPLAY_REASONS.includes(trace.reason)
      ? trace.reason
      : 'no-dom-matches',
    selected: count(trace.selected),
    matched: count(trace.matched),
    invalidWindows: count(trace.invalidWindows),
    overlapping: count(trace.overlapping),
    limited: count(trace.limited),
    fingerprintMatches:
      typeof trace.fingerprintMatches === 'boolean'
        ? trace.fingerprintMatches
        : null,
  };
}

/** Project every field again at export; never spread untrusted stored objects. */
export function safeAiAnalysisDiagnostic(
  report: AiAnalysisDiagnostic,
): AiAnalysisDiagnostic {
  return {
    schemaVersion: 1,
    analysisId: uuid.test(report.analysisId) ? report.analysisId : '',
    at:
      typeof report.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(report.at) &&
      Number.isFinite(Date.parse(report.at))
        ? new Date(report.at).toISOString()
        : '',
    version:
      typeof report.version === 'string' &&
      /^\d{1,5}(?:\.\d{1,5}){2,3}$/u.test(report.version)
        ? report.version
        : EXTENSION_RUNTIME_VERSION,
    model: AI_GATEWAY_SUGGESTED_MODELS.some((model) => model === report.model)
      ? report.model
      : 'custom-model',
    status: ['started', 'complete', 'failed'].includes(report.status)
      ? report.status
      : 'failed',
    stage: [
      'request',
      'response',
      'validation',
      'evaluation',
      'complete',
    ].includes(report.stage)
      ? report.stage
      : 'request',
    errorCategory:
      report.errorCategory === null
        ? null
        : [
              'network',
              'authentication',
              'timeout',
              'invalid-response',
              'storage',
              'runtime',
              'privacy',
              'unknown',
            ].includes(report.errorCategory)
          ? report.errorCategory
          : 'unknown',
    input: {
      articleBlocks: count(report.input?.articleBlocks),
      sentBlocks: count(report.input?.sentBlocks),
      sentCharacters: count(report.input?.sentCharacters),
      ...(report.input?.offeredPassages !== undefined
        ? { offeredPassages: count(report.input.offeredPassages) }
        : {}),
      queries: count(report.input?.queries),
      knowledgeSignals: count(report.input?.knowledgeSignals),
      coverage: report.input?.coverage === 'complete' ? 'complete' : 'partial',
    },
    output: {
      returned:
        report.output?.returned === null
          ? null
          : count(report.output?.returned),
      inspected: count(report.output?.inspected),
      overLimit: count(report.output?.overLimit),
      accepted: count(report.output?.accepted),
      selected: count(report.output?.selected),
      mergedOrLimited: count(report.output?.mergedOrLimited),
      candidates: (Array.isArray(report.output?.candidates)
        ? report.output.candidates
        : []
      )
        .slice(0, 6)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          index: count(item.index),
          accepted: item.accepted === true,
          relevance: probability(item.relevance),
          ...(item.relevanceInput && typeof item.relevanceInput === 'object'
            ? { relevanceInput: safeRelevanceInput(item.relevanceInput) }
            : {}),
          confidence: probability(item.confidence),
          reasons: [
            ...new Set(Array.isArray(item.reasons) ? item.reasons : []),
          ].filter((reason) => PASSAGE_REJECTIONS.includes(reason)),
        })),
    },
    display:
      report.display && typeof report.display === 'object'
        ? safeDisplayTrace(report.display)
        : null,
  };
}

interface StoredReport {
  report: AiAnalysisDiagnostic;
  pageUrl: string;
}
async function loadStored(
  storage: chrome.storage.StorageArea,
): Promise<StoredReport | null> {
  const value = (await storage.get(AI_ANALYSIS_DIAGNOSTIC_KEY))[
    AI_ANALYSIS_DIAGNOSTIC_KEY
  ] as StoredReport | undefined;
  return value?.report &&
    typeof value.pageUrl === 'string' &&
    uuid.test(value.report.analysisId)
    ? value
    : null;
}
export async function loadAiAnalysisDiagnostic(
  storage = privateStorage,
): Promise<AiAnalysisDiagnostic | null> {
  const stored = await loadStored(storage);
  return stored ? safeAiAnalysisDiagnostic(stored.report) : null;
}

/** Caller holds the data-operation lock. An older response cannot replace a newer request. */
export async function saveAiAnalysisDiagnostic(
  report: AiAnalysisDiagnostic,
  pageUrl: string,
  storage = privateStorage,
): Promise<void> {
  const previous = await loadStored(storage);
  if (
    report.status !== 'started' &&
    previous?.report.analysisId !== report.analysisId
  )
    return;
  await storage.set({
    [AI_ANALYSIS_DIAGNOSTIC_KEY]: {
      pageUrl,
      report: safeAiAnalysisDiagnostic(report),
    },
  });
}

export async function recordAiPassageDisplay(
  analysisId: string,
  pageUrl: string,
  display: PassageDisplayTrace,
  storage = privateStorage,
): Promise<boolean> {
  const stored = await loadStored(storage);
  if (
    !stored ||
    stored.report.analysisId !== analysisId ||
    stored.pageUrl !== pageUrl ||
    stored.report.status !== 'complete'
  )
    return false;
  await storage.set({
    [AI_ANALYSIS_DIAGNOSTIC_KEY]: {
      pageUrl,
      report: safeAiAnalysisDiagnostic({ ...stored.report, display }),
    },
  });
  return true;
}

export function aiAnalysisDiagnosticExport(
  report: AiAnalysisDiagnostic,
): string {
  return JSON.stringify(
    {
      ...safeAiAnalysisDiagnostic(report),
      privacy: {
        excluded: [
          'keys',
          'profile-text',
          'article-text',
          'urls',
          'titles',
          'raw-model-response',
          'raw-errors',
        ],
        reportStoredLocally: true,
      },
      thresholds: {
        relevance: 0.65,
        confidence: 0.65,
        maxModelCandidates: 6,
        maxDisplayedPassages: 3,
      },
      notes: {
        preparedPassages:
          'offeredPassages counts fixed context windows available to the model. Selections use passage IDs; validation and display preserve those windows.',
        returned:
          'null = no structured response; 0 = model returned an empty passage list.',
        mergedOrLimited:
          'Accepted candidates combined or removed by overlap/deduplication or the selection limit.',
        display:
          'null = no page observation received. matched counts passages located on the page, not proof the user read them.',
        customModel: 'Unlisted model identifiers are redacted as custom-model.',
        relevanceScale:
          'relevance is normalized to 0–1. relevanceInput preserves the numeric input (0–100 only), its type and interpreted scale. Any valid score above 1 makes the inspected batch percentage-scale; mixed scales are interpreted conservatively. No strings are exported.',
      },
    },
    null,
    2,
  );
}
