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

const MAX_HISTORY_TOPICS = 40;
const MAX_HISTORY_SOURCES = 30;

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

export interface DiagnosticProfileExport {
  exportSchemaVersion: 1;
  exportedAt: string;
  extensionVersion: string;
  privacy: {
    containsPersonalData: true;
    excluded: string[];
  };
  profile: PortableProfile | null;
  currentContext: ScenarioState;
  evidence: {
    browserHistory: ReturnType<typeof safeHistoryEvidence>;
    readwise: ReturnType<typeof safeReadwiseSettings>;
    obsidian: ReturnType<typeof safeObsidianSettings>;
    notion: ReturnType<typeof safeNotionSettings>;
  };
  feedback: {
    novelty: {
      total: number;
      markedNew: number;
      markedKnown: number;
      lastRecordedAt: string | null;
    };
    utilityCalibration: UtilityCalibrationModel | null;
  };
}

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

function safeHistoryEvidence(
  evidence: BrowserHistoryEvidence | null,
  settings: BrowserHistorySettings | null,
) {
  if (!evidence && !settings) return null;
  return {
    lookbackDays: settings?.lookbackDays ?? null,
    lastProcessedAt: settings?.lastProcessedAt ?? evidence?.generatedAt ?? null,
    permissionRetained: settings?.permissionRetained ?? false,
    periodStart: evidence?.periodStart ?? null,
    periodEnd: evidence?.periodEnd ?? null,
    processedUrlCount:
      evidence?.processedUrlCount ?? settings?.processedUrlCount ?? 0,
    totalVisitCount:
      evidence?.totalVisitCount ?? settings?.totalVisitCount ?? 0,
    excludedUrlCount:
      evidence?.excludedUrlCount ?? settings?.excludedUrlCount ?? 0,
    topics: (evidence?.topics ?? [])
      .slice(0, MAX_HISTORY_TOPICS)
      .map(({ topic, pageCount, visitCount, sourceCount, confidence }) => ({
        topic,
        pageCount,
        visitCount,
        sourceCount,
        confidence,
      })),
    sources: (evidence?.sources ?? [])
      .slice(0, MAX_HISTORY_SOURCES)
      .map(({ hostname, pageCount, visitCount, typedCount, confidence }) => ({
        hostname,
        pageCount,
        visitCount,
        typedCount,
        confidence,
      })),
  };
}

function safeReadwiseSettings(settings: ReadwiseSettings) {
  return {
    connected: settings.connected,
    lastSyncedAt: settings.lastSyncedAt,
    evidenceUpdatedAt: settings.evidenceUpdatedAt ?? null,
    sourceCount: settings.sourceCount,
    highlightCount: settings.highlightCount,
    noteCount: settings.noteCount,
    excludedSourceCount: settings.excludedSourceCount,
  };
}

function safeObsidianSettings(settings: ObsidianSettings) {
  return {
    connected: settings.connected,
    lastIndexedAt: settings.lastIndexedAt,
    evidenceUpdatedAt: settings.evidenceUpdatedAt ?? null,
    noteCount: settings.noteCount,
    fragmentCount: settings.fragmentCount,
    skippedFileCount: settings.skippedFileCount,
  };
}

function safeNotionSettings(settings: NotionSettings) {
  return {
    connected: settings.connected,
    sourceMode: settings.sourceMode,
    lastSyncedAt: settings.lastSyncedAt,
    evidenceUpdatedAt: settings.evidenceUpdatedAt ?? null,
    pageCount: settings.pageCount,
    fragmentCount: settings.fragmentCount,
    excludedPageCount: settings.excludedPageCount,
  };
}

export function buildDiagnosticProfileExport(
  input: DiagnosticProfileInput,
  now = new Date(),
): DiagnosticProfileExport {
  const noveltyDates = input.noveltyFeedback
    .map((record) => record.createdAt)
    .sort();
  return {
    exportSchemaVersion: 1,
    exportedAt: now.toISOString(),
    extensionVersion: EXTENSION_RUNTIME_VERSION,
    privacy: {
      containsPersonalData: true,
      excluded: [
        'api-keys-and-access-tokens',
        'authentication-and-session-secrets',
        'visited-page-list-and-page-urls',
        'article-text-and-titles',
        'readwise-highlight-and-note-text',
        'obsidian-note-paths-and-text',
        'notion-workspace-identifiers-and-page-text',
        'raw-feedback-claims-and-excerpts',
      ],
    },
    profile: toPortableProfile(input.profile),
    currentContext: { ...input.scenario },
    evidence: {
      browserHistory: safeHistoryEvidence(
        input.historyEvidence,
        input.historySettings,
      ),
      readwise: safeReadwiseSettings(input.readwise),
      obsidian: safeObsidianSettings(input.obsidian),
      notion: safeNotionSettings(input.notion),
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
        lastRecordedAt: noveltyDates.at(-1) ?? null,
      },
      utilityCalibration: input.utilityCalibration,
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
