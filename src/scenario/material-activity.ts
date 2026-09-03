import { textMatchScore } from '../analyzer/text-match';
import type {
  AnalysisContext,
  AttentionScenario,
  PageCapture,
  PersonalizationSignal,
} from '../shared/types';
import type { PersonalProfile } from '../profile/schema';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

const CEFR_RANK = new Map<CefrLevel, number>(
  CEFR_LEVELS.map((level, index) => [level, index + 1]),
);

const LEARNING_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:learn|learning|lesson|course|tutorial|exercise|grammar|vocabulary|study guide|exam prep(?:aration)?|language practice)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:lernen|lektion|kurs|übung|übungen|grammatik|wortschatz|sprachpraxis|prüfungsvorbereitung)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:учить|учиться|изучать|изучение|урок|курс|упражнени\p{L}*|грамматик\p{L}*|словарн\p{L}*|подготовк\p{L}* к экзамен\p{L}*)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:aprender|aprendizaje|lección|curso|ejercicio|gramática|vocabulario)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:apprendre|apprentissage|leçon|cours|exercice|grammaire|vocabulaire)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])(?:imparare|apprendimento|lezione|corso|esercizio|grammatica|vocabolario)(?=$|[^\p{L}\p{N}])/iu,
  /(?:学习|课程|教程|练习|语法|词汇)/u,
  /(?:تعلم|درس|دورة|تمرين|قواعد|مفردات)/u,
  /(?:सीखना|पाठ|कोर्स|अभ्यास|व्याकरण|शब्दावली)/u,
] as const;

const EXPLICIT_WORK_PATTERNS = [
  /\b(?:project|client|production|deployment|decision|proposal|interview|application|job search)\b/iu,
  /\b(?:проект|клиент|продакшн|развёртыван|решени[ея]|предложени[ея]|собеседован|заявк|поиск работы)\b/iu,
  /\b(?:projekt|kunde|produktion|bereitstellung|entscheidung|vorstellungsgespräch|bewerbung|arbeitssuche)\b/iu,
] as const;

const LANGUAGE_LEVEL_CONTEXT =
  /(?:^|[^\p{L}\p{N}])(?:cefr|language|german|deutsch|deutsche|english|englisch|spanish|español|french|français|italian|italiano|русск\p{L}*|английск\p{L}*|немецк\p{L}*|испанск\p{L}*|французск\p{L}*|итальянск\p{L}*|sprach|grammar|grammatik|vocabulary|wortschatz)(?=$|[^\p{L}\p{N}])/iu;

export interface MaterialScenarioFit {
  detectedActivity: 'learn' | 'work' | 'unknown';
  confidence: number;
  mismatch: boolean;
  suggestedScenario: AttentionScenario | null;
  reason: string | null;
}

export interface CefrRange {
  levels: CefrLevel[];
  minimum: CefrLevel;
  maximum: CefrLevel;
  span: number;
}

export interface LearningMaterialFit {
  detected: boolean;
  recommendation: 'open' | 'maybe' | 'skip';
  score: number;
  levelFit: 'aligned' | 'broad' | 'too-basic' | 'too-advanced' | 'unknown';
  formatFit: 'strong' | 'neutral' | 'weak';
  reason: string;
  expectedValue: string;
}

function materialSummary(material: PageCapture): string {
  return [material.title, material.excerpt, ...material.headings]
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractCefrLevels(value: string): CefrLevel[] {
  const matches = value.match(
    /(?:^|[^\p{L}\p{N}])(A1|A2|B1|B2|C1|C2)(?=$|[^\p{L}\p{N}])/giu,
  );
  if (!matches) return [];
  const found = new Set<CefrLevel>();
  for (const match of matches) {
    const level = match.match(/A1|A2|B1|B2|C1|C2/iu)?.[0]?.toUpperCase();
    if (level && CEFR_RANK.has(level as CefrLevel)) {
      found.add(level as CefrLevel);
    }
  }
  return [...found].sort(
    (left, right) => (CEFR_RANK.get(left) ?? 0) - (CEFR_RANK.get(right) ?? 0),
  );
}

export function highestCefrLevel(value: string): CefrLevel | null {
  return extractCefrLevels(value).at(-1) ?? null;
}

export function extractCefrRange(value: string): CefrRange | null {
  const levels = extractCefrLevels(value);
  const minimum = levels[0];
  const maximum = levels.at(-1);
  if (!minimum || !maximum) return null;
  return {
    levels,
    minimum,
    maximum,
    span: cefrLevelRank(maximum) - cefrLevelRank(minimum),
  };
}

export function cefrLevelRank(level: CefrLevel): number {
  return CEFR_RANK.get(level) ?? 0;
}

const STRONG_LEARNING_FORMAT_PATTERNS = [
  /\b(?:conversation|dialogue|interview|listening practice|real[- ]life|from the streets|guided practice|worked examples?)\b/iu,
  /\b(?:gespräch|dialog|hörverstehen|sprachpraxis|von der straße|alltagssprache|beispiele?|übungen?)\b/iu,
  /\b(?:разговорн|диалог|аудирован|практик|разбор|пример|упражнени)\b/iu,
] as const;

const STRUCTURED_LEARNING_FORMAT_PATTERNS = [
  /\b(?:lesson|course|tutorial|grammar|vocabulary|verbs?|curriculum|exam prep(?:aration)?)\b/iu,
  /\b(?:lektion|kurs|grammatik|wortschatz|verben?|prüfungsvorbereitung)\b/iu,
  /\b(?:урок|курс|грамматик|словар|глагол|подготовк[аи] к экзамену)\b/iu,
] as const;

const WEAK_LEARNING_FORMAT_PATTERNS = [
  /\b(?:learn|study|memorize)\b.{0,24}\b(?:in|while) (?:your )?sleep\b/iu,
  /\b(?:im schlaf|pendant (?:le )?sommeil|durante el sueño|во сне)\b/iu,
  /\b(?:effortless|without studying|no effort|learn instantly|master .* in \d+ (?:minutes?|hours?|days?))\b/iu,
  /\b(?:без усилий|без учёбы|мгновенно|выучить .* за \d+ (?:минут|час|дн))\b/iu,
] as const;

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyLearningFormat(
  material: PageCapture,
): LearningMaterialFit['formatFit'] {
  const summary = materialSummary(material);
  if (matchesAny(summary, WEAK_LEARNING_FORMAT_PATTERNS)) return 'weak';
  if (
    matchesAny(summary, STRONG_LEARNING_FORMAT_PATTERNS) ||
    matchesAny(summary, STRUCTURED_LEARNING_FORMAT_PATTERNS)
  ) {
    return 'strong';
  }
  return 'neutral';
}

function matchingProfileLevels(
  profile: PersonalProfile | null,
  material: PageCapture,
): { current: number | null; target: number | null } {
  if (!profile) return { current: null, target: null };
  const summary = materialSummary(material);
  const relevant = (value: string): boolean =>
    textMatchScore(value, summary) >= 0.18;
  const currentRanks = profile.expertise
    .filter((item) => relevant(item.topic))
    .flatMap((item) => extractCefrLevels([item.topic, ...item.basis].join(' ')))
    .map(cefrLevelRank);
  const targetRanks = [
    ...profile.goals
      .filter((item) => item.status === 'active' && relevant(item.goal))
      .flatMap((item) => extractCefrLevels(item.goal)),
    ...(profile.learningAreas ?? [])
      .filter((item) => relevant(`${item.topic} ${item.focus ?? ''}`))
      .flatMap((item) =>
        extractCefrLevels(`${item.topic} ${item.focus ?? ''}`),
      ),
  ].map(cefrLevelRank);
  const current = currentRanks.length > 0 ? Math.max(...currentRanks) : null;
  let target = targetRanks.length > 0 ? Math.max(...targetRanks) : null;
  if (current !== null && target === null) target = Math.min(6, current + 1);
  if (current !== null && target !== null) target = Math.max(current, target);
  return { current, target };
}

function learningLevelFit(
  material: PageCapture,
  profile: PersonalProfile | null,
): LearningMaterialFit['levelFit'] {
  const range = extractCefrRange(materialSummary(material));
  if (!range) return 'unknown';
  const minimum = cefrLevelRank(range.minimum);
  const maximum = cefrLevelRank(range.maximum);
  const { current, target } = matchingProfileLevels(profile, material);
  if (current !== null && maximum < current) return 'too-basic';
  if (target !== null && minimum > Math.min(6, target + 1)) {
    return 'too-advanced';
  }
  // A1-C1 is not a C1 recommendation. It is a catalogue in which only a
  // subset may fit, so keep it neutral until the user opens the right module.
  if (range.span >= 3) return 'broad';
  if (
    current === null ||
    target === null ||
    (maximum >= current && minimum <= target)
  ) {
    return 'aligned';
  }
  return 'unknown';
}

function strongestLearningSignal(
  signals: PersonalizationSignal[],
  effect: PersonalizationSignal['effect'],
): number {
  return Math.max(
    0,
    ...signals
      .filter((signal) => {
        if (signal.effect !== effect) return false;
        return effect === 'negative'
          ? signal.kind === 'lowValueTopic' || signal.kind === 'expertise'
          : signal.kind === 'learningArea' ||
              signal.kind === 'goal' ||
              signal.kind === 'interest';
      })
      .map((signal) => signal.matchScore * signal.confidence),
  );
}

/**
 * Evaluates whether a learning item is useful now, not merely whether it is
 * instructional. The rules are generic: subject match, level range and format
 * are derived from each user's profile and the material title/snippet.
 */
export function assessLearningMaterialFit(
  material: PageCapture,
  profile: PersonalProfile | null,
  signals: PersonalizationSignal[],
): LearningMaterialFit {
  const scenarioFit = assessMaterialScenarioFit(material, {
    scenario: 'learn',
    intent: '',
    availableMinutes: 15,
  });
  const detected = scenarioFit.detectedActivity === 'learn';
  const levelFit = learningLevelFit(material, profile);
  const formatFit = classifyLearningFormat(material);
  const positive = strongestLearningSignal(signals, 'positive');
  const negative = strongestLearningSignal(signals, 'negative');
  let score = 0.18 + positive * 0.5 - negative * 0.25;
  if (detected) score += 0.12;
  if (levelFit === 'aligned') score += 0.2;
  if (levelFit === 'broad') score += 0.05;
  if (levelFit === 'too-basic') score -= 0.3;
  if (levelFit === 'too-advanced') score -= 0.22;
  if (levelFit === 'unknown') score += 0.05;
  if (formatFit === 'strong') score += 0.15;
  if (formatFit === 'weak') score -= 0.3;
  score = Math.max(0, Math.min(1, score));

  const range = extractCefrRange(materialSummary(material));
  if (!detected || positive < 0.22) {
    return {
      detected,
      recommendation: 'maybe',
      score,
      levelFit,
      formatFit,
      reason:
        'Учебный формат виден, но связь с вашей областью изучения пока неясна.',
      expectedValue: 'Учебная ценность пока неясна',
    };
  }
  if (levelFit === 'too-basic') {
    return {
      detected,
      recommendation: 'skip',
      score,
      levelFit,
      formatFit,
      reason: `Материал заканчивается на уровне ${range?.maximum ?? 'ниже вашего'} и, вероятно, будет слишком базовым.`,
      expectedValue: 'Скорее повтор уже освоенного',
    };
  }
  if (levelFit === 'too-advanced') {
    return {
      detected,
      recommendation: 'maybe',
      score,
      levelFit,
      formatFit,
      reason: `Материал начинается с уровня ${range?.minimum ?? 'выше текущего'} и может оказаться преждевременным.`,
      expectedValue: 'Уровень может быть слишком высоким',
    };
  }
  if (formatFit === 'weak') {
    return {
      detected,
      recommendation: score < 0.55 ? 'skip' : 'maybe',
      score,
      levelFit,
      formatFit,
      reason:
        'Тема подходит, но формат обещает пассивное обучение и даёт слабый учебный сигнал.',
      expectedValue: 'Сомнительная учебная отдача',
    };
  }
  if (levelFit === 'broad') {
    return {
      detected,
      recommendation: 'maybe',
      score,
      levelFit,
      formatFit,
      reason: `Курс охватывает ${range?.minimum ?? ''}–${range?.maximum ?? ''}; полезна только часть на вашем уровне.`,
      expectedValue: 'Ищите раздел своего уровня',
    };
  }
  if (score >= 0.6 && formatFit === 'strong') {
    return {
      detected,
      recommendation: 'open',
      score,
      levelFit,
      formatFit,
      reason:
        levelFit === 'aligned' && range
          ? `Тема и уровень ${range.minimum}–${range.maximum} совпадают с вашей траекторией обучения.`
          : 'Практический учебный формат совпадает с вашей областью изучения.',
      expectedValue:
        levelFit === 'aligned'
          ? 'Практика на подходящем уровне'
          : 'Практика навыка из вашего профиля',
    };
  }
  return {
    detected,
    recommendation: 'maybe',
    score,
    levelFit,
    formatFit,
    reason: 'Тема подходит, но по заголовку неясны уровень или учебная отдача.',
    expectedValue: 'Возможна учебная ценность',
  };
}

function explicitIntentMatch(
  material: PageCapture,
  context: AnalysisContext,
): boolean {
  const intent = context.intent.trim();
  if (!intent) return false;
  const summary = materialSummary(material);
  const materialLevels = extractCefrLevels(summary);
  const intentLevels = extractCefrLevels(intent);
  return (
    textMatchScore(intent, summary) >= 0.5 ||
    intentLevels.some((level) => materialLevels.includes(level))
  );
}

/**
 * Distinguishes what the material asks the user to do from why the underlying
 * skill matters to them. A career-related learning goal must not turn every
 * lesson or course into a Work recommendation.
 */
export function assessMaterialScenarioFit(
  material: PageCapture,
  context: AnalysisContext,
): MaterialScenarioFit {
  const summary = materialSummary(material);
  const cefrLevels = extractCefrLevels(summary);
  const learningPatternCount = LEARNING_PATTERNS.filter((pattern) =>
    pattern.test(summary),
  ).length;
  const workPatternCount = EXPLICIT_WORK_PATTERNS.filter((pattern) =>
    pattern.test(summary),
  ).length;
  const learningConfidence = Math.min(
    1,
    (cefrLevels.length > 0 && LANGUAGE_LEVEL_CONTEXT.test(summary) ? 0.22 : 0) +
      (learningPatternCount > 0 ? 0.78 : 0),
  );
  const workConfidence = workPatternCount > 0 ? 0.72 : 0;
  const detectedActivity =
    learningConfidence >= 0.75
      ? 'learn'
      : workConfidence >= 0.7
        ? 'work'
        : 'unknown';
  const mismatch =
    context.scenario === 'work' &&
    detectedActivity === 'learn' &&
    !explicitIntentMatch(material, context);

  return {
    detectedActivity,
    confidence: Math.max(learningConfidence, workConfidence),
    mismatch,
    suggestedScenario: mismatch ? 'learn' : null,
    reason: mismatch
      ? 'Это учебный материал. Для рабочей оценки переключитесь на сценарий «Учёба» или укажите конкретную рабочую задачу.'
      : null,
  };
}
