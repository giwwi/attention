import {
  loadBrowserHistoryEvidence,
  loadBrowserHistorySettings,
} from '../history/storage';
import type {
  BrowserHistoryEvidence,
  BrowserHistorySettings,
} from '../history/evidence';
import { loadNotionSettings } from '../notion/storage';
import type { NotionSettings } from '../notion/types';
import { loadNovelPassageFeedback } from '../novelty/feedback';
import type { NovelPassageFeedbackRecord } from '../novelty/feedback';
import { loadObsidianSettings } from '../obsidian/storage';
import type { ObsidianSettings } from '../obsidian/types';
import { loadReadwiseSettings } from '../readwise/storage';
import type { ReadwiseSettings } from '../readwise/evidence';
import { loadScenarioState } from '../scenario/scenario';
import type { ScenarioState } from '../shared/types';
import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { loadUtilityCalibration } from '../utility/storage';
import type { UtilityCalibrationModel } from '../utility/calibration';
import type { PersonalProfile, PortableProfile } from './schema';
import { loadProfile } from './storage';

export interface DiagnosticProfileInput {
  profile: PersonalProfile | null;
  scenario: ScenarioState;
  historyEvidence: BrowserHistoryEvidence | null;
  historySettings: BrowserHistorySettings | null;
  readwise: ReadwiseSettings;
  obsidian: ObsidianSettings;
  notion: NotionSettings;
  noveltyFeedback: NovelPassageFeedbackRecord[];
  utilityCalibration: UtilityCalibrationModel | null;
}

export type DiagnosticProfileExport = ReturnType<
  typeof buildDiagnosticProfileExport
>;

export function toPortableProfile(
  profile: PersonalProfile | null,
): PortableProfile | null {
  if (!profile) return null;
  return {
    schemaVersion: profile.schemaVersion,
    generatedAt: profile.updatedAt,
    interests: profile.interests.map(({ topic, strength, confidence }) => ({
      topic,
      strength,
      confidence,
    })),
    goals: profile.goals.map(({ goal, priority, status, confidence }) => ({
      goal,
      priority,
      status,
      confidence,
    })),
    expertise: profile.expertise.map(({ topic, level, confidence, basis }) => ({
      topic,
      level,
      confidence,
      basis: [...basis],
    })),
    contentPreferences: profile.contentPreferences
      ? {
          preferredDepth: profile.contentPreferences.preferredDepth,
          noveltyPreference: profile.contentPreferences.noveltyPreference,
          avoidRepetition: profile.contentPreferences.avoidRepetition,
          preferredFormats: [...profile.contentPreferences.preferredFormats],
          confidence: profile.contentPreferences.confidence,
        }
      : null,
    lowValueTopics: profile.lowValueTopics.map(({ topic, confidence }) => ({
      topic,
      confidence,
    })),
    demonstratedKnowledge: profile.demonstratedKnowledge.map(
      ({ topic, statement, evidenceType, confidence, basis }) => ({
        topic,
        statement,
        evidenceType,
        confidence,
        basis: [...basis],
      }),
    ),
    learningAreas: profile.learningAreas.map(
      ({ topic, focus, confidence }) => ({ topic, focus, confidence }),
    ),
    leisureProfile: {
      status: profile.leisureProfile.status,
      preferences: profile.leisureProfile.preferences.map(
        ({ kind, category, preference, confidence, evidenceType, basis }) => ({
          kind,
          category,
          preference,
          confidence,
          evidenceType,
          basis,
        }),
      ),
      noveltyPreference: profile.leisureProfile.noveltyPreference,
      effortPreference: profile.leisureProfile.effortPreference,
      typicalSessionMinutes: profile.leisureProfile.typicalSessionMinutes,
      confidence: profile.leisureProfile.confidence,
    },
    uncertainties: profile.uncertainties.map(({ topic, note, confidence }) => ({
      topic,
      note,
      confidence,
    })),
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

export function buildDiagnosticProfileExport(
  input: DiagnosticProfileInput,
  now = new Date(),
) {
  return {
    exportSchemaVersion: 2,
    exportedAt: now.toISOString(),
    extensionVersion: EXTENSION_RUNTIME_VERSION,
    privacy: {
      aggregateCountsOnly: true,
      excluded: [
        'profile-content-and-goals',
        'scenario-content',
        'topics-and-hostnames',
        'urls-titles-and-text',
        'source-identifiers-and-paths',
        'keys-tokens-and-passwords',
        'feedback-content-and-history-timestamps',
      ],
    },
    profile: {
      present: input.profile !== null,
      interestCount: input.profile?.interests.length ?? 0,
      goalCount: input.profile?.goals.length ?? 0,
      knowledgeCount: input.profile?.demonstratedKnowledge.length ?? 0,
    },
    evidence: {
      browserHistory: {
        processedUrlCount: count(
          input.historyEvidence?.processedUrlCount ??
            input.historySettings?.processedUrlCount,
        ),
        totalVisitCount: count(
          input.historyEvidence?.totalVisitCount ??
            input.historySettings?.totalVisitCount,
        ),
        excludedUrlCount: count(
          input.historyEvidence?.excludedUrlCount ??
            input.historySettings?.excludedUrlCount,
        ),
      },
      readwise: {
        sourceCount: count(input.readwise.sourceCount),
        highlightCount: count(input.readwise.highlightCount),
        noteCount: count(input.readwise.noteCount),
      },
      obsidian: {
        noteCount: count(input.obsidian.noteCount),
        fragmentCount: count(input.obsidian.fragmentCount),
        skippedFileCount: count(input.obsidian.skippedFileCount),
      },
      notion: {
        pageCount: count(input.notion.pageCount),
        fragmentCount: count(input.notion.fragmentCount),
        excludedPageCount: count(input.notion.excludedPageCount),
      },
    },
    feedback: {
      novelty: {
        total: input.noveltyFeedback.length,
        markedNew: input.noveltyFeedback.filter(
          (record) => record.value === 'new',
        ).length,
        markedKnown: input.noveltyFeedback.filter(
          (record) => record.value === 'known',
        ).length,
      },
      utilitySampleSize: count(input.utilityCalibration?.sampleSize),
    },
  };
}

export async function createDiagnosticProfileExport(): Promise<DiagnosticProfileExport> {
  const [
    profile,
    scenario,
    historyEvidence,
    historySettings,
    readwise,
    obsidian,
    notion,
    noveltyFeedback,
    utilityCalibration,
  ] = await Promise.all([
    loadProfile(),
    loadScenarioState(),
    loadBrowserHistoryEvidence(),
    loadBrowserHistorySettings(),
    loadReadwiseSettings(),
    loadObsidianSettings(),
    loadNotionSettings(),
    loadNovelPassageFeedback(),
    loadUtilityCalibration(),
  ]);
  return buildDiagnosticProfileExport({
    profile,
    scenario,
    historyEvidence,
    historySettings,
    readwise,
    obsidian,
    notion,
    noveltyFeedback,
    utilityCalibration,
  });
}

export function diagnosticProfileFilename(now = new Date()): string {
  return `attention-diagnostic-profile-${now.toISOString().slice(0, 10)}.json`;
}

export function downloadDiagnosticProfile(
  snapshot: DiagnosticProfileExport,
  filename = diagnosticProfileFilename(),
): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
