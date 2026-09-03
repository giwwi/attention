import {
  LEGACY_PROFILE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  type ExpertiseLevel,
  type GoalPriority,
  type GoalStatus,
  type KnowledgeEvidenceType,
  type PortableContentPreferences,
  type PortableDemonstratedKnowledge,
  type PortableExpertise,
  type PortableGoal,
  type PortableInterest,
  type PortableLearningArea,
  type PortableLeisurePreference,
  type PortableLeisureProfile,
  type PortableLowValueTopic,
  type PortableProfile,
  type PortableProfileUncertainty,
  type PreferenceLevel,
  type LeisureNoveltyPreference,
  type LeisurePreferenceKind,
  type LeisurePreferenceLevel,
  type LeisureProfileStatus,
} from './schema';
import type { CognitiveEffort } from '../shared/types';

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  value: PortableProfile;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 500;
const MAX_BASIS_ITEMS = 20;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(
  value: unknown,
  path: string,
  errors: string[],
): string | null {
  if (typeof value !== 'string') {
    errors.push(`${path}: ожидается текст.`);
    return null;
  }
  const withoutControls = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      );
    })
    .join('');
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    errors.push(`${path}: значение не может быть пустым.`);
    return null;
  }
  if (cleaned.length > MAX_TEXT_LENGTH) {
    errors.push(`${path}: текст длиннее ${MAX_TEXT_LENGTH} символов.`);
    return null;
  }
  return cleaned;
}

function cleanOptionalText(
  value: unknown,
  path: string,
  errors: string[],
): string | null {
  if (value === undefined || value === null || value === '') return null;
  return cleanText(value, path, errors);
}

function confidence(
  value: unknown,
  path: string,
  errors: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: ожидается число от 0 до 1.`);
    return null;
  }
  if (value < 0 || value > 1) {
    errors.push(`${path}: значение должно быть от 0 до 1.`);
    return null;
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
): T | null {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.push(`${path}: допустимые значения — ${allowed.join(', ')}.`);
    return null;
  }
  return value as T;
}

function array(value: unknown, path: string, errors: string[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path}: ожидается массив.`);
    return [];
  }
  if (value.length > MAX_ITEMS) {
    errors.push(`${path}: допускается не более ${MAX_ITEMS} элементов.`);
    return value.slice(0, MAX_ITEMS);
  }
  return value;
}

function parseInterest(
  value: unknown,
  path: string,
  errors: string[],
): PortableInterest | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const strength = confidence(item.strength, `${path}.strength`, errors);
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  return topic !== null && strength !== null && certainty !== null
    ? { topic, strength, confidence: certainty }
    : null;
}

function parseGoal(
  value: unknown,
  path: string,
  errors: string[],
): PortableGoal | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const goal = cleanText(item.goal, `${path}.goal`, errors);
  const priority = enumValue<GoalPriority>(
    item.priority,
    ['low', 'medium', 'high'],
    `${path}.priority`,
    errors,
  );
  const status = enumValue<GoalStatus>(
    item.status,
    ['active', 'paused', 'completed'],
    `${path}.status`,
    errors,
  );
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  return goal && priority && status && certainty !== null
    ? { goal, priority, status, confidence: certainty }
    : null;
}

function parseExpertise(
  value: unknown,
  path: string,
  errors: string[],
): PortableExpertise | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const level = enumValue<ExpertiseLevel>(
    item.level,
    ['beginner', 'intermediate', 'advanced', 'expert'],
    `${path}.level`,
    errors,
  );
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  const basis: string[] = [];
  if (item.basis !== undefined) {
    for (const [index, entry] of array(item.basis, `${path}.basis`, errors)
      .slice(0, MAX_BASIS_ITEMS)
      .entries()) {
      const text = cleanText(entry, `${path}.basis[${index}]`, errors);
      if (text) basis.push(text);
    }
  }
  return topic && level && certainty !== null
    ? { topic, level, confidence: certainty, basis }
    : null;
}

function parseLowValueTopic(
  value: unknown,
  path: string,
  errors: string[],
): PortableLowValueTopic | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  return topic && certainty !== null ? { topic, confidence: certainty } : null;
}

function parseDemonstratedKnowledge(
  value: unknown,
  path: string,
  errors: string[],
): PortableDemonstratedKnowledge | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const statement = cleanText(item.statement, `${path}.statement`, errors);
  const evidenceType = enumValue<KnowledgeEvidenceType>(
    item.evidence_type,
    ['demonstrated', 'explicitly_stated', 'inferred'],
    `${path}.evidence_type`,
    errors,
  );
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  const basis: string[] = [];
  for (const [index, entry] of array(item.basis, `${path}.basis`, errors)
    .slice(0, MAX_BASIS_ITEMS)
    .entries()) {
    const text = cleanText(entry, `${path}.basis[${index}]`, errors);
    if (text) basis.push(text);
  }
  return topic && statement && evidenceType && certainty !== null
    ? {
        topic,
        statement,
        evidenceType,
        confidence: certainty,
        basis,
      }
    : null;
}

function parseLearningArea(
  value: unknown,
  path: string,
  errors: string[],
): PortableLearningArea | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const focus = cleanOptionalText(item.focus, `${path}.focus`, errors);
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  return topic && certainty !== null
    ? { topic, focus, confidence: certainty }
    : null;
}

function parseUncertainty(
  value: unknown,
  path: string,
  errors: string[],
): PortableProfileUncertainty | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const topic = cleanText(item.topic, `${path}.topic`, errors);
  const note = cleanText(item.note, `${path}.note`, errors);
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  return topic && note && certainty !== null
    ? { topic, note, confidence: certainty }
    : null;
}

function parsePreferences(
  value: unknown,
  errors: string[],
): PortableContentPreferences | null {
  if (value === undefined || value === null) return null;
  const item = record(value);
  if (!item) {
    errors.push('content_preferences: ожидается объект.');
    return null;
  }
  const preferredDepth = enumValue<PreferenceLevel>(
    item.preferred_depth,
    ['low', 'medium', 'high'],
    'content_preferences.preferred_depth',
    errors,
  );
  const noveltyPreference = enumValue<PreferenceLevel>(
    item.novelty_preference,
    ['low', 'medium', 'high'],
    'content_preferences.novelty_preference',
    errors,
  );
  if (typeof item.avoid_repetition !== 'boolean') {
    errors.push(
      'content_preferences.avoid_repetition: ожидается true или false.',
    );
  }
  const certainty = confidence(
    item.confidence,
    'content_preferences.confidence',
    errors,
  );
  const preferredFormats: string[] = [];
  for (const [index, entry] of array(
    item.preferred_formats,
    'content_preferences.preferred_formats',
    errors,
  ).entries()) {
    const text = cleanText(
      entry,
      `content_preferences.preferred_formats[${index}]`,
      errors,
    );
    if (text) preferredFormats.push(text);
  }
  return preferredDepth &&
    noveltyPreference &&
    typeof item.avoid_repetition === 'boolean' &&
    certainty !== null
    ? {
        preferredDepth,
        noveltyPreference,
        avoidRepetition: item.avoid_repetition,
        preferredFormats,
        confidence: certainty,
      }
    : null;
}

function parseLeisurePreference(
  value: unknown,
  path: string,
  errors: string[],
): PortableLeisurePreference | null {
  const item = record(value);
  if (!item) {
    errors.push(`${path}: ожидается объект.`);
    return null;
  }
  const kind = enumValue<LeisurePreferenceKind>(
    item.kind,
    ['genre', 'format', 'creator', 'recreationalTopic', 'dislike'],
    `${path}.kind`,
    errors,
  );
  const category = cleanText(item.category, `${path}.category`, errors);
  const preference = enumValue<LeisurePreferenceLevel>(
    item.preference,
    ['unknown', 'low', 'medium', 'high'],
    `${path}.preference`,
    errors,
  );
  const certainty = confidence(item.confidence, `${path}.confidence`, errors);
  const evidenceType = enumValue<KnowledgeEvidenceType>(
    item.evidence_type,
    ['demonstrated', 'explicitly_stated', 'inferred'],
    `${path}.evidence_type`,
    errors,
  );
  const basis = cleanText(item.basis, `${path}.basis`, errors);
  return kind &&
    category &&
    preference &&
    certainty !== null &&
    evidenceType &&
    basis
    ? { kind, category, preference, confidence: certainty, evidenceType, basis }
    : null;
}

function parseLeisureProfile(
  value: unknown,
  errors: string[],
  allowMissing: boolean,
): PortableLeisureProfile {
  if (value === undefined && allowMissing) {
    return {
      status: 'insufficient_data',
      preferences: [],
      noveltyPreference: null,
      effortPreference: null,
      typicalSessionMinutes: null,
      confidence: 0,
    };
  }
  const item = record(value);
  if (!item) {
    errors.push(
      'leisure_profile: ожидается объект и он не может быть пропущен.',
    );
    return {
      status: 'insufficient_data',
      preferences: [],
      noveltyPreference: null,
      effortPreference: null,
      typicalSessionMinutes: null,
      confidence: 0,
    };
  }
  const status = enumValue<LeisureProfileStatus>(
    item.status,
    ['available', 'insufficient_data'],
    'leisure_profile.status',
    errors,
  );
  const preferences = array(
    item.preferences,
    'leisure_profile.preferences',
    errors,
  )
    .map((entry, index) =>
      parseLeisurePreference(
        entry,
        `leisure_profile.preferences[${index}]`,
        errors,
      ),
    )
    .filter((entry): entry is PortableLeisurePreference => entry !== null);
  const noveltyPreference =
    item.novelty_preference === null || item.novelty_preference === undefined
      ? null
      : enumValue<LeisureNoveltyPreference>(
          item.novelty_preference,
          ['familiar', 'balanced', 'novel'],
          'leisure_profile.novelty_preference',
          errors,
        );
  const effortPreference =
    item.effort_preference === null || item.effort_preference === undefined
      ? null
      : enumValue<CognitiveEffort>(
          item.effort_preference,
          ['low', 'medium', 'high'],
          'leisure_profile.effort_preference',
          errors,
        );
  let typicalSessionMinutes: number | null = null;
  if (
    item.typical_session_minutes !== null &&
    item.typical_session_minutes !== undefined
  ) {
    if (
      typeof item.typical_session_minutes !== 'number' ||
      !Number.isFinite(item.typical_session_minutes) ||
      item.typical_session_minutes < 1 ||
      item.typical_session_minutes > 480
    ) {
      errors.push(
        'leisure_profile.typical_session_minutes: ожидается число от 1 до 480 или null.',
      );
    } else {
      typicalSessionMinutes = Math.round(item.typical_session_minutes);
    }
  }
  const certainty = confidence(
    item.confidence,
    'leisure_profile.confidence',
    errors,
  );
  if (status === 'insufficient_data' && preferences.length > 0) {
    errors.push(
      'leisure_profile: при insufficient_data preferences должен быть пустым.',
    );
  }
  return {
    status: status ?? 'insufficient_data',
    preferences,
    noveltyPreference,
    effortPreference,
    typicalSessionMinutes,
    confidence: certainty ?? 0,
  };
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function validatePortableProfile(raw: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return {
      ok: false,
      errors: [
        'JSON не распознан. Вставьте только полный JSON-объект из ответа AI.',
      ],
    };
  }

  const root = record(parsed);
  if (!root) return { ok: false, errors: ['В корне должен быть JSON-объект.'] };
  const errors: string[] = [];
  const isLegacy = root.schema_version === LEGACY_PROFILE_SCHEMA_VERSION;
  if (root.schema_version !== PROFILE_SCHEMA_VERSION && !isLegacy) {
    errors.push(`schema_version: ожидается версия ${PROFILE_SCHEMA_VERSION}.`);
  }

  let generatedAt: string | null = null;
  if (root.generated_at !== undefined && root.generated_at !== null) {
    if (
      typeof root.generated_at !== 'string' ||
      Number.isNaN(Date.parse(root.generated_at))
    ) {
      errors.push('generated_at: ожидается корректная ISO-8601 дата.');
    } else {
      generatedAt = new Date(root.generated_at).toISOString();
    }
  }

  const interests = array(root.interests, 'interests', errors)
    .map((item, index) => parseInterest(item, `interests[${index}]`, errors))
    .filter((item): item is PortableInterest => item !== null);
  const goals = array(root.goals, 'goals', errors)
    .map((item, index) => parseGoal(item, `goals[${index}]`, errors))
    .filter((item): item is PortableGoal => item !== null);
  const expertise = array(root.expertise, 'expertise', errors)
    .map((item, index) => parseExpertise(item, `expertise[${index}]`, errors))
    .filter((item): item is PortableExpertise => item !== null);
  const lowValueTopics = array(
    root.low_value_topics,
    'low_value_topics',
    errors,
  )
    .map((item, index) =>
      parseLowValueTopic(item, `low_value_topics[${index}]`, errors),
    )
    .filter((item): item is PortableLowValueTopic => item !== null);
  const contentPreferences = parsePreferences(root.content_preferences, errors);
  const demonstratedKnowledge = array(
    root.demonstrated_knowledge,
    'demonstrated_knowledge',
    errors,
  )
    .map((item, index) =>
      parseDemonstratedKnowledge(
        item,
        `demonstrated_knowledge[${index}]`,
        errors,
      ),
    )
    .filter((item): item is PortableDemonstratedKnowledge => item !== null);
  const learningAreas = array(root.learning_areas, 'learning_areas', errors)
    .map((item, index) =>
      parseLearningArea(item, `learning_areas[${index}]`, errors),
    )
    .filter((item): item is PortableLearningArea => item !== null);
  const uncertainties = array(root.uncertainties, 'uncertainties', errors)
    .map((item, index) =>
      parseUncertainty(item, `uncertainties[${index}]`, errors),
    )
    .filter((item): item is PortableProfileUncertainty => item !== null);
  const leisureProfile = parseLeisureProfile(
    root.leisure_profile,
    errors,
    isLegacy,
  );

  if (
    interests.length === 0 &&
    goals.length === 0 &&
    expertise.length === 0 &&
    lowValueTopics.length === 0 &&
    demonstratedKnowledge.length === 0 &&
    learningAreas.length === 0 &&
    leisureProfile.preferences.length === 0 &&
    uncertainties.length === 0 &&
    contentPreferences === null
  ) {
    errors.push('Профиль пуст: добавьте хотя бы один полезный пункт.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      generatedAt,
      interests,
      goals,
      expertise,
      contentPreferences,
      lowValueTopics,
      demonstratedKnowledge,
      learningAreas,
      leisureProfile,
      uncertainties,
    },
  };
}
