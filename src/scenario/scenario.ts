import type {
  AnalysisContext,
  AttentionScenario,
  CognitiveEffort,
  RelaxIntent,
  ScenarioSource,
  ScenarioState,
} from '../shared/types';

export const SCENARIO_STATE_KEY = 'attentionScenario';
export const DEFAULT_ATTENTION_SCENARIO: AttentionScenario = 'work';

interface StorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const SCENARIO_LABELS: Record<AttentionScenario, string> = {
  work: 'Работа',
  learn: 'Учёба',
  explore: 'Исследовать',
  relax: 'Отдых',
};

export const RELAX_INTENT_LABELS: Record<RelaxIntent, string> = {
  chill: 'Спокойное',
  funny: 'Смешное',
  interesting: 'Интересное',
  exciting: 'Захватывающее',
  familiar: 'Знакомое',
  surprise: 'Удивите меня',
};

export const EFFORT_LABELS: Record<CognitiveEffort, string> = {
  low: 'Легко',
  medium: 'Средне',
  high: 'Можно сложное',
};

export function createDefaultScenarioState(now = new Date()): ScenarioState {
  return {
    scenario: DEFAULT_ATTENTION_SCENARIO,
    scenarioUpdatedAt: now.toISOString(),
    scenarioSource: 'default',
    relaxIntent: null,
    desiredEffort: null,
    leisureFormats: [],
  };
}

export function isAttentionScenario(
  value: unknown,
): value is AttentionScenario {
  return ['work', 'learn', 'explore', 'relax'].includes(String(value));
}

function isRelaxIntent(value: unknown): value is RelaxIntent {
  return [
    'chill',
    'funny',
    'interesting',
    'exciting',
    'familiar',
    'surprise',
  ].includes(String(value));
}

function isCognitiveEffort(value: unknown): value is CognitiveEffort {
  return ['low', 'medium', 'high'].includes(String(value));
}

function isScenarioSource(value: unknown): value is ScenarioSource {
  return ['default', 'manual', 'suggested-confirmed'].includes(String(value));
}

export function normalizeScenarioState(
  value: unknown,
  now = new Date(),
): ScenarioState {
  const fallback = createDefaultScenarioState(now);
  if (!value || typeof value !== 'object') return fallback;
  const state = value as Record<string, unknown>;
  return {
    scenario: isAttentionScenario(state.scenario)
      ? state.scenario
      : fallback.scenario,
    scenarioUpdatedAt:
      typeof state.scenarioUpdatedAt === 'string'
        ? state.scenarioUpdatedAt
        : fallback.scenarioUpdatedAt,
    scenarioSource: isScenarioSource(state.scenarioSource)
      ? state.scenarioSource
      : fallback.scenarioSource,
    relaxIntent: isRelaxIntent(state.relaxIntent) ? state.relaxIntent : null,
    desiredEffort: isCognitiveEffort(state.desiredEffort)
      ? state.desiredEffort
      : null,
    leisureFormats: Array.isArray(state.leisureFormats)
      ? state.leisureFormats
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [],
  };
}

export async function loadScenarioState(
  storage: StorageArea = chrome.storage.local,
): Promise<ScenarioState> {
  const stored = await storage.get(SCENARIO_STATE_KEY);
  return normalizeScenarioState(stored[SCENARIO_STATE_KEY]);
}

export async function saveScenarioState(
  state: ScenarioState,
  storage: StorageArea = chrome.storage.local,
): Promise<void> {
  await storage.set({ [SCENARIO_STATE_KEY]: normalizeScenarioState(state) });
}

export function changeScenario(
  current: ScenarioState,
  scenario: AttentionScenario,
  source: ScenarioSource = 'manual',
  now = new Date(),
): ScenarioState {
  return {
    ...current,
    scenario,
    scenarioUpdatedAt: now.toISOString(),
    scenarioSource: source,
  };
}

export function normalizeAnalysisContext(value: unknown): AnalysisContext {
  const context =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const minutes = Number(context.availableMinutes);
  return {
    intent: typeof context.intent === 'string' ? context.intent : '',
    availableMinutes:
      minutes === 5 || minutes === 15 || minutes === 30 ? minutes : 15,
    scenario: isAttentionScenario(context.scenario)
      ? context.scenario
      : DEFAULT_ATTENTION_SCENARIO,
    relaxIntent: isRelaxIntent(context.relaxIntent)
      ? context.relaxIntent
      : null,
    desiredEffort: isCognitiveEffort(context.desiredEffort)
      ? context.desiredEffort
      : null,
    leisureFormats: Array.isArray(context.leisureFormats)
      ? context.leisureFormats.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
  };
}

export function contextFromScenarioState(
  state: ScenarioState,
  intent: string,
  availableMinutes: AnalysisContext['availableMinutes'],
): AnalysisContext {
  return {
    intent,
    availableMinutes,
    scenario: state.scenario,
    relaxIntent: state.relaxIntent,
    desiredEffort: state.desiredEffort,
    leisureFormats: state.leisureFormats,
  };
}
