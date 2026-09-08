/**
 * A conservative veto for lexical claim matching, not a fact checker or an
 * entailment model. Missing or different factual details cannot prove that a
 * claim is already known. Ambiguous formats deliberately lose recall.
 */

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  '%': 'percent',
  '٪': 'percent',
  percent: 'percent',
  percentage: 'percent',
  процентов: 'percent',
  процента: 'percent',
  процент: 'percent',
  '‰': 'permille',
  $: 'usd',
  usd: 'usd',
  dollars: 'usd',
  dollar: 'usd',
  '€': 'eur',
  eur: 'eur',
  euros: 'eur',
  euro: 'eur',
  '£': 'gbp',
  gbp: 'gbp',
  '¥': 'yen',
  '₹': 'inr',
  inr: 'inr',
  '₽': 'rub',
  rub: 'rub',
  рублей: 'rub',
  g: 'g',
  gram: 'g',
  grams: 'g',
  г: 'g',
  грамм: 'g',
  граммов: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  кг: 'kg',
  килограмм: 'kg',
  килограммов: 'kg',
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  мг: 'mg',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  м: 'm',
  метров: 'm',
  cm: 'cm',
  centimeters: 'cm',
  centimetres: 'cm',
  см: 'cm',
  mm: 'mm',
  millimeters: 'mm',
  миллиметров: 'mm',
  мм: 'mm',
  km: 'km',
  kilometers: 'km',
  kilometres: 'km',
  км: 'km',
  s: 's',
  sec: 's',
  second: 's',
  seconds: 's',
  секунд: 's',
  секунды: 's',
  ms: 'ms',
  millisecond: 'ms',
  milliseconds: 'ms',
  мс: 'ms',
  min: 'min',
  minute: 'min',
  minutes: 'min',
  минут: 'min',
  минуты: 'min',
  мин: 'min',
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
  часов: 'h',
  часа: 'h',
  day: 'day',
  days: 'day',
  дней: 'day',
  дня: 'day',
  year: 'year',
  years: 'year',
  лет: 'year',
  года: 'year',
  kb: 'kb',
  mb: 'mb',
  gb: 'gb',
  tb: 'tb',
  million: 'million',
  millions: 'million',
  миллионов: 'million',
  млн: 'million',
  billion: 'billion',
  billions: 'billion',
  миллиардов: 'billion',
  млрд: 'billion',
};

function normalizedText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[०-९]/gu, (digit) => String(digit.charCodeAt(0) - 0x966))
    .replace(/−/gu, '-')
    .replace(/٫/gu, '.')
    .replace(/[’']/gu, "'")
    .replace(/\b(can't|cannot)\b/gu, 'can not')
    .replace(/n't\b/gu, ' not')
    .replace(/\s+/gu, ' ')
    .trim();
}

function numericValue(value: string): string {
  // A single separator followed by three digits is ambiguous across locales:
  // keep it literal rather than assuming 1,000 means 1000 instead of 1.000.
  if (/^[+-]?\d+[.,]\d{3}$/u.test(value)) return value;
  if (!/^[+-]?\d+(?:[.,]\d+)?$/u.test(value)) return value;
  const sign = value.startsWith('-') ? '-' : '';
  const [integer = '0', fraction = ''] = value
    .replace(/^[+-]/u, '')
    .replace(',', '.')
    .split('.');
  const whole = integer.replace(/^0+(?=\d)/u, '');
  const decimal = fraction.replace(/0+$/u, '');
  return `${whole === '0' && !decimal ? '' : sign}${whole}${decimal ? `.${decimal}` : ''}`;
}

function quantities(text: string): string[] {
  return [...text.matchAll(/[+-]?\d+(?:[.,]\d+)*/gu)].map((match) => {
    const before = text.slice(0, match.index).trimEnd();
    const after = text.slice(match.index + match[0].length).trimStart();
    const prefixUnit = before.match(/[$€£¥₹₽]$/u)?.[0];
    const suffixUnit = after.match(/^(%|٪|‰|[\p{L}]+)/u)?.[0];
    const suffix = suffixUnit
      ? (UNIT_ALIASES[suffixUnit] ?? `literal:${suffixUnit}`)
      : '';
    // Ordinary prose following a number is not a unit. Preserve unknown units
    // only when attached, e.g. 10kWh, instead of interpreting "10 participants".
    const attached = !/^\s/u.test(text.slice(match.index + match[0].length));
    let unit = prefixUnit
      ? UNIT_ALIASES[prefixUnit]
      : suffixUnit && (UNIT_ALIASES[suffixUnit] || attached)
        ? suffix
        : '';
    const temperature = after.match(/^°\s*([cf])/u);
    if (temperature) unit = `temperature:${temperature[1]}`;
    const rate = after
      .slice(temperature?.[0].length ?? suffixUnit?.length ?? 0)
      .match(/^\s*(?:\/|per\s+|в\s+)([\p{L}]+)/u)?.[1];
    if (rate) unit += `/${UNIT_ALIASES[rate] ?? rate}`;
    if (
      /^(?:percentage|percent) points?\b|^процентн[\p{L}]* пункт/iu.test(after)
    )
      unit = 'percentage-point';
    const operator =
      before.match(/(?:<=|>=|[<>≤≥~≈])$/u)?.[0] ??
      (/(?:at least|no less than|не менее)\s*$/u.test(before)
        ? '>='
        : /(?:at most|no more than|up to|не более)\s*$/u.test(before)
          ? '<='
          : /(?:more than|greater than|более|больше)\s*$/u.test(before)
            ? '>'
            : /(?:less than|fewer than|менее|меньше)\s*$/u.test(before)
              ? '<'
              : '=');
    return `${operator.replace('≤', '<=').replace('≥', '>=')}:${numericValue(match[0])}:${unit}`;
  });
}

const MONTHS = [
  ['january', 'jan', 'января'],
  ['february', 'feb', 'февраля'],
  ['march', 'mar', 'марта'],
  ['april', 'apr', 'апреля'],
  ['may', 'мая'],
  ['june', 'jun', 'июня'],
  ['july', 'jul', 'июля'],
  ['august', 'aug', 'августа'],
  ['september', 'sep', 'sept', 'сентября'],
  ['october', 'oct', 'октября'],
  ['november', 'nov', 'ноября'],
  ['december', 'dec', 'декабря'],
];

function monthSignature(text: string): string[] {
  return MONTH_MATCHERS.flatMap((patterns, index) =>
    patterns.some((pattern) => pattern.test(text)) ? [String(index)] : [],
  );
}

const MONTH_MATCHERS = MONTHS.map((names) =>
  names.map(
    (name) =>
      new RegExp(
        `(?:^|[^\\p{L}])${name}\\.?\\s+\\d|\\d\\s+${name}(?:[^\\p{L}]|$)`,
        'u',
      ),
  ),
);

const NEGATION =
  /(?:^|[^\p{L}])(?:not|no|never|without|neither|none|не|нет|ни|без|никогда|nicht|kein[\p{L}]*|ohne|non|senza|mai|nunca|sin|jamais|pas|sans|لا|ليس|لم|لن|بدون|नहीं|बिना)(?=[^\p{L}]|$)|[不没無无未]/gu;
const DIRECTIONS = [
  [
    /(?:^|[^\p{L}])(?:increase[\p{L}]*|increasing|rise[\p{L}]*|rising|rose|grew|grow[\p{L}]*|higher|more|увелич[\p{L}]*|возрос[\p{L}]*|вырос[\p{L}]*|повыс[\p{L}]*|рост)(?=[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:decrease[\p{L}]*|decreasing|reduc[\p{L}]*|fall[\p{L}]*|fell|declin[\p{L}]*|lower|fewer|less|сниз[\p{L}]*|сниже[\p{L}]*|уменьш[\p{L}]*|сократ[\p{L}]*|упал[\p{L}]*)(?=[^\p{L}]|$)/u,
  ],
  [
    /(?:^|[^\p{L}])(?:support[\p{L}]*|confirm[\p{L}]*|подтвер[\p{L}]*)(?=[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:reject[\p{L}]*|refut[\p{L}]*|disprov[\p{L}]*|опровер[\p{L}]*)(?=[^\p{L}]|$)/u,
  ],
  [
    /(?:^|[^\p{L}])(?:safe|безопасн[\p{L}]*)(?=[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:unsafe|небезопасн[\p{L}]*)(?=[^\p{L}]|$)/u,
  ],
  [
    /(?:^|[^\p{L}])(?:effective|эффективн[\p{L}]*)(?=[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])(?:ineffective|неэффективн[\p{L}]*)(?=[^\p{L}]|$)/u,
  ],
];

const CLAIM_FORCE = [
  /(?:^|[^\p{L}])(?:all|every|each|always|всегда|все|всё|кажд[\p{L}]*|люб[\p{L}]*)(?=[^\p{L}]|$)/u,
  /(?:^|[^\p{L}])(?:some|sometimes|occasionally|некотор[\p{L}]*|иногда)(?=[^\p{L}]|$)/u,
  /(?:^|[^\p{L}])(?:guarantee[\p{L}]*|guaranteeing|must|certainly|гарантир[\p{L}]*|обязан[\p{L}]*|обязательн[\p{L}]*)(?=[^\p{L}]|$)/u,
  /(?:^|[^\p{L}])(?:may(?!\s+\d)|might|could|can|possibly|possible|может|могут|возмож[\p{L}]*|вероят[\p{L}]*)(?=[^\p{L}]|$)/u,
];

function sameList(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function caseSensitiveUnits(text: string): string[] {
  // Lowercasing is appropriate for prose, but MB is not Mb and mW is not MW.
  return [
    ...text
      .normalize('NFKC')
      .matchAll(/\p{N}\s*([kMGT]?[Bb]|[mMμu]?[AVWS]|[mkMG]?Hz)(?![\p{L}])/gu),
  ].map((match) => match[1]!);
}

function negationSignature(text: string): string[] {
  const meaningful = (value: string) =>
    (value.match(/[\p{L}]+/gu) ?? []).filter(
      (word) =>
        !/^(?:a|an|the|do|does|did|can|could|will|would|shall|should|is|are|was|were|be|been|has|have|had|бы|был|была|были)$/u.test(
          word,
        ),
    );
  return [...text.matchAll(NEGATION)]
    .map((match) => {
      const before = meaningful(text.slice(0, match.index)).at(-1) ?? '';
      const after =
        meaningful(text.slice(match.index + match[0].length))[0] ?? '';
      return `${before}:${after}`;
    })
    .sort();
}

function forceScope(text: string, counterpart: string): string {
  const core = counterpart.replace(/[.!?。！？]+$/u, '').trimEnd();
  // A note can repeat the full claim and explain a different predicate after
  // it: "evaluation requires benchmarks before decisions can be trusted".
  // That "can" modifies trusting decisions, not requiring benchmarks. Scope
  // force markers to the shared, verbatim main clause only in this narrow case;
  // quantities, negation and opposing directions still inspect the full text.
  if (
    (core.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 8 &&
    text.startsWith(core) &&
    /^\s+(?:before|after|because|so that|прежде чем|после того как|потому что|чтобы)\s/u.test(
      text.slice(core.length),
    )
  )
    return core;
  return text;
}

export function claimsFactuallyCompatible(
  left: string,
  right: string,
): boolean {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return false;
  if (!sameList(caseSensitiveUnits(left), caseSensitiveUnits(right)))
    return false;
  if (a === b) return true;
  if (!sameList(quantities(a), quantities(b))) return false;
  if (!sameList(monthSignature(a), monthSignature(b))) return false;
  const forceA = forceScope(a, b).replace(/\bat all\b/gu, '');
  const forceB = forceScope(b, a).replace(/\bat all\b/gu, '');
  for (const force of CLAIM_FORCE) {
    if (force.test(forceA) !== force.test(forceB)) return false;
  }
  // "Not only" is additive, rather than a negation of the following claim.
  const polarityText = (value: string) =>
    value.replace(
      /\bnot only\b|не только|no (?:less|more) than|не (?:менее|более)/gu,
      '',
    );
  if (
    !sameList(
      negationSignature(polarityText(a)),
      negationSignature(polarityText(b)),
    )
  )
    return false;
  for (const [positive, negative] of DIRECTIONS) {
    const direction = (value: string) =>
      Number(positive!.test(value)) - Number(negative!.test(value));
    if (direction(a) * direction(b) === -1) return false;
  }
  return true;
}
