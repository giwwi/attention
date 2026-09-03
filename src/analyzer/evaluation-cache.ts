import { loadBrowserHistorySettings } from '../history/storage';
import { loadNotionSettings } from '../notion/storage';
import { loadClaimMemoryRevision } from '../novelty/feedback';
import { loadObsidianSettings } from '../obsidian/storage';
import type { PersonalProfile } from '../profile/schema';
import { loadReadwiseSettings } from '../readwise/storage';
import type {
  AnalysisContext,
  EvaluationCacheVersion,
  StoredEvaluation,
} from '../shared/types';
import type { MaterialFeatures } from './material-features';
import { stableTextFingerprint } from './material-features';
import { loadUtilityCalibration } from '../utility/storage';

export interface EvaluationSourceVersions {
  profile: string;
  history: string;
  readwise: string;
  obsidian: string;
  notion: string;
  claimMemory: string;
  utilityCalibration: string;
}

function version(value: string | null | undefined): string {
  return value || 'none';
}

export async function loadEvaluationSourceVersions(
  profile: PersonalProfile | null,
): Promise<EvaluationSourceVersions> {
  const [history, readwise, obsidian, notion, claimMemory, utilityCalibration] =
    await Promise.all([
      loadBrowserHistorySettings(),
      loadReadwiseSettings(),
      loadObsidianSettings(),
      loadNotionSettings(),
      loadClaimMemoryRevision(),
      loadUtilityCalibration(),
    ]);
  return {
    profile: version(profile?.updatedAt),
    history: version(history?.lastProcessedAt),
    readwise: version(readwise.evidenceUpdatedAt ?? readwise.lastSyncedAt),
    obsidian: version(obsidian.evidenceUpdatedAt ?? obsidian.lastIndexedAt),
    notion: version(notion.evidenceUpdatedAt ?? notion.lastSyncedAt),
    claimMemory: version(claimMemory),
    utilityCalibration: version(utilityCalibration?.updatedAt),
  };
}

export function analysisContextFingerprint(context: AnalysisContext): string {
  return stableTextFingerprint(
    JSON.stringify({
      scenario: context.scenario,
      intent: context.intent,
      availableMinutes: context.availableMinutes,
      relaxIntent: context.relaxIntent ?? null,
      desiredEffort: context.desiredEffort ?? null,
      leisureFormats: [...(context.leisureFormats ?? [])].sort(),
    }),
  );
}

export function createEvaluationCacheVersion(
  features: MaterialFeatures,
  context: AnalysisContext,
  sources: EvaluationSourceVersions,
): EvaluationCacheVersion {
  return {
    schemaVersion: 4,
    ...sources,
    articleText: features.articleTextFingerprint,
    analysisContext: analysisContextFingerprint(context),
  };
}

function sameSources(
  stored: EvaluationCacheVersion | undefined,
  sources: EvaluationSourceVersions,
  context: AnalysisContext,
): boolean {
  return Boolean(
    stored?.schemaVersion === 4 &&
    stored.profile === sources.profile &&
    stored.history === sources.history &&
    stored.readwise === sources.readwise &&
    stored.obsidian === sources.obsidian &&
    stored.notion === sources.notion &&
    stored.claimMemory === sources.claimMemory &&
    stored.utilityCalibration === sources.utilityCalibration &&
    stored.analysisContext === analysisContextFingerprint(context),
  );
}

export function isEvaluationCacheCurrent(
  stored: StoredEvaluation | null | undefined,
  sources: EvaluationSourceVersions,
  context: AnalysisContext,
  features?: MaterialFeatures,
): boolean {
  if (!stored || !sameSources(stored.cacheVersion, sources, context)) {
    return false;
  }
  return (
    features === undefined ||
    stored.cacheVersion?.articleText === features.articleTextFingerprint
  );
}
