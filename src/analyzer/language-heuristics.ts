export const SUPPORTED_HEURISTIC_LANGUAGES = [
  'en',
  'ru',
  'de',
  'es',
  'fr',
  'it',
  'zh',
  'ar',
  'hi',
] as const;

export type HeuristicLanguage = (typeof SUPPORTED_HEURISTIC_LANGUAGES)[number];

export type HeuristicMarker =
  | 'navigation'
  | 'recommendation'
  | 'forecast'
  | 'evidence'
  | 'reasoning'
  | 'calibration';

interface LanguageHeuristicPack {
  detection: RegExp;
  markers: Record<HeuristicMarker, RegExp>;
}

export interface HeuristicLanguageResolution {
  language: string | null;
  heuristicLanguage: HeuristicLanguage | null;
  supported: boolean;
  source: 'metadata' | 'content' | 'unknown';
}

const packs = {
  en: {
    detection: /\b(the|and|that|with|from|this|because|however|study|data)\b/iu,
    markers: {
      navigation:
        /^(subscribe|sign in|log in|share|comments?|related|read more)\b/iu,
      recommendation:
        /\b(should|must|need to|ought to|recommend(?:s|ed|ation)?)\b/iu,
      forecast:
        /\b(will|forecast|predict(?:s|ed|ion)?|expected to|likely to)\b/iu,
      evidence:
        /\b(stud(?:y|ies)|research|data|survey|experiment|sample|results?|evidence|according to|source|doi)\b/iu,
      reasoning:
        /\b(because|therefore|however|although|leads? to|results? in|causes?|mechanism|consequently)\b/iu,
      calibration:
        /\b(may|might|could|uncertain(?:ty)?|limitation|alternative|possibly|caveat)\b/iu,
    },
  },
  ru: {
    detection: /\b(и|в|на|что|это|для|как|потому|однако|исследован\w*)\b/iu,
    markers: {
      navigation:
        /^(подписаться|войти|комментарии|поделиться|похожие|читать дальше)\b/iu,
      recommendation:
        /\b(следует|необходимо|нужно|стоит|рекоменду\w*|долж\w*)\b/iu,
      forecast: /\b(прогноз\w*|ожидается|вероятно|будет|предполагается)\b/iu,
      evidence:
        /\b(исследован\w*|данн\w*|опрос\w*|эксперимент\w*|выборк\w*|результат\w*|доказательств\w*|согласно|источник\w*)\b/iu,
      reasoning:
        /\b(потому что|поэтому|однако|хотя|приводит|вызывает|механизм|следовательно)\b/iu,
      calibration:
        /\b(вероятно|возможно|может|могут|ограничен\w*|неопределен\w*|альтернатив\w*|оговорк\w*)\b/iu,
    },
  },
  de: {
    detection: /\b(der|die|das|und|ist|mit|von|weil|jedoch|studie|daten)\b/iu,
    markers: {
      navigation:
        /^(abonnieren|anmelden|teilen|kommentare|ähnliche|mehr lesen)\b/iu,
      recommendation: /\b(sollte|muss|müssen|empfehl\w*|notwendig)\b/iu,
      forecast: /\b(wird|werden|prognos\w*|erwartet|wahrscheinlich)\b/iu,
      evidence:
        /\b(studie\w*|forschung|daten|umfrage\w*|experiment\w*|stichprobe\w*|ergebnis\w*|beleg\w*|laut|quelle\w*)\b/iu,
      reasoning:
        /\b(weil|daher|deshalb|jedoch|obwohl|führt zu|verursacht|mechanismus|folglich)\b/iu,
      calibration:
        /\b(könnte|möglicherweise|unsicher\w*|einschränkung\w*|alternative\w*|wahrscheinlich)\b/iu,
    },
  },
  es: {
    detection:
      /\b(el|la|los|las|y|que|con|porque|sin embargo|estudio|datos)\b/iu,
    markers: {
      navigation:
        /^(suscribirse|iniciar sesión|compartir|comentarios|relacionado|leer más)\b/iu,
      recommendation: /\b(debería|debe|necesita|recomiend\w*|es necesario)\b/iu,
      forecast:
        /\b(será|serán|pronóstic\w*|predic\w*|se espera|probablemente)\b/iu,
      evidence:
        /\b(estudio\w*|investigación|datos|encuesta\w*|experimento\w*|muestra\w*|resultado\w*|evidencia|según|fuente\w*)\b/iu,
      reasoning:
        /\b(porque|por lo tanto|sin embargo|aunque|conduce a|causa|mecanismo|en consecuencia)\b/iu,
      calibration:
        /\b(puede|podría|quizá|inciert\w*|limitación\w*|alternativa\w*|posiblemente)\b/iu,
    },
  },
  fr: {
    detection:
      /\b(le|la|les|et|que|avec|parce que|cependant|étude|données)\b/iu,
    markers: {
      navigation:
        /^(s’abonner|s'abonner|se connecter|partager|commentaires|associé|lire plus)\b/iu,
      recommendation: /\b(devrait|doit|faut|recommand\w*|nécessaire)\b/iu,
      forecast: /\b(sera|seront|prévision\w*|prédit|devrait|probablement)\b/iu,
      evidence:
        /\b(étude\w*|recherche|données|sondage\w*|expérience\w*|échantillon\w*|résultat\w*|preuve\w*|selon|source\w*)\b/iu,
      reasoning:
        /\b(parce que|donc|cependant|bien que|conduit à|cause|mécanisme|par conséquent)\b/iu,
      calibration:
        /\b(peut|pourrait|incertain\w*|limite\w*|alternative\w*|probablement|éventuellement)\b/iu,
    },
  },
  it: {
    detection: /\b(il|la|gli|le|e|che|con|perché|tuttavia|studio|dati)\b/iu,
    markers: {
      navigation:
        /^(iscriviti|accedi|condividi|commenti|correlati|leggi di più)\b/iu,
      recommendation: /\b(dovrebbe|deve|bisogna|raccomand\w*|necessario)\b/iu,
      forecast:
        /\b(sarà|saranno|previsione\w*|predice|si prevede|probabilmente)\b/iu,
      evidence:
        /\b(studio\w*|ricerca|dati|sondaggio\w*|esperimento\w*|campione\w*|risultat\w*|prova\w*|secondo|fonte\w*)\b/iu,
      reasoning:
        /\b(perché|quindi|tuttavia|sebbene|porta a|causa|meccanismo|di conseguenza)\b/iu,
      calibration:
        /\b(può|potrebbe|incert\w*|limit\w*|alternativ\w*|probabilmente|forse)\b/iu,
    },
  },
  zh: {
    detection: /(的|了|是|在|和|与|因为|但是|研究|数据)/u,
    markers: {
      navigation: /^(订阅|登录|分享|评论|相关|阅读更多)/u,
      recommendation: /(应该|必须|需要|建议|值得)/u,
      forecast: /(将会|预测|预计|可能会|很可能)/u,
      evidence: /(研究|数据|调查|实验|样本|结果|证据|根据|来源)/u,
      reasoning: /(因为|所以|因此|然而|虽然|导致|机制|结果是)/u,
      calibration: /(可能|也许|不确定|局限|限制|替代解释|或许)/u,
    },
  },
  ar: {
    detection: /(من|في|على|أن|هذا|هذه|لأن|لكن|دراسة|بيانات)/u,
    markers: {
      navigation: /^(اشترك|تسجيل الدخول|مشاركة|تعليقات|ذات صلة|اقرأ المزيد)/u,
      recommendation: /(ينبغي|يجب|يحتاج|نوصي|ضروري)/u,
      forecast: /(سوف|سـ|توقع|يتوقع|من المرجح)/u,
      evidence: /(دراسة|بحث|بيانات|مسح|تجربة|عينة|نتائج|دليل|وفقًا|مصدر)/u,
      reasoning: /(لأن|لذلك|ومع ذلك|رغم أن|يؤدي إلى|يسبب|آلية|وبالتالي)/u,
      calibration: /(قد|ربما|عدم اليقين|قيود|بديل|من المحتمل)/u,
    },
  },
  hi: {
    detection: /(का|की|के|और|में|यह|कि|क्योंकि|लेकिन|अध्ययन|डेटा)/u,
    markers: {
      navigation:
        /^(सदस्यता लें|लॉग इन|साझा करें|टिप्पणियाँ|संबंधित|और पढ़ें)/u,
      recommendation: /(चाहिए|ज़रूरी|आवश्यक|सिफारिश|करना होगा)/u,
      forecast: /(होगा|होगी|पूर्वानुमान|अनुमान|संभावना है)/u,
      evidence:
        /(अध्ययन|शोध|डेटा|सर्वेक्षण|प्रयोग|नमूना|परिणाम|साक्ष्य|अनुसार|स्रोत)/u,
      reasoning: /(क्योंकि|इसलिए|हालांकि|जिससे|कारण|तंत्र|फलस्वरूप)/u,
      calibration: /(शायद|संभव|अनिश्चित|सीमा|वैकल्पिक|संभावित)/u,
    },
  },
} as const satisfies Record<HeuristicLanguage, LanguageHeuristicPack>;

const supported = new Set<string>(SUPPORTED_HEURISTIC_LANGUAGES);

function baseLanguage(language: string | null): string | null {
  const normalized = language?.trim().toLowerCase().replace('_', '-');
  if (!normalized) return null;
  return normalized.split('-')[0] || null;
}

function unicodeAwarePattern(pattern: RegExp, global: boolean): RegExp {
  let source = pattern.source.replaceAll('\\w', '[\\p{L}\\p{M}\\p{N}_]');
  if (source.startsWith('\\b') && source.endsWith('\\b')) {
    source = `(?<![\\p{L}\\p{N}])${source.slice(2, -2)}(?![\\p{L}\\p{N}])`;
  } else if (source.endsWith('\\b')) {
    source = `${source.slice(0, -2)}(?![\\p{L}\\p{N}])`;
  }
  const flags = pattern.flags.replace('g', '') + (global ? 'g' : '');
  return new RegExp(source, flags);
}

function occurrences(value: string, pattern: RegExp): number {
  return value.match(unicodeAwarePattern(pattern, true))?.length ?? 0;
}

function scriptCount(value: string, script: string): number {
  return value.match(new RegExp(`\\p{Script=${script}}`, 'gu'))?.length ?? 0;
}

function detectedLanguage(content: string): HeuristicLanguage | null {
  const sample = content.slice(0, 12_000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 30) return null;
  const scriptCandidates: Array<[HeuristicLanguage, string]> = [
    ['zh', 'Han'],
    ['ar', 'Arabic'],
    ['hi', 'Devanagari'],
    ['ru', 'Cyrillic'],
  ];
  for (const [language, script] of scriptCandidates) {
    if (
      scriptCount(sample, script) / letters >= 0.55 &&
      occurrences(sample, packs[language].detection) >= 4
    ) {
      return language;
    }
  }
  const latinShare = scriptCount(sample, 'Latin') / letters;
  if (latinShare < 0.7) return null;
  const ranked = (['en', 'de', 'es', 'fr', 'it'] as const)
    .map((language) => ({
      language,
      score: occurrences(sample, packs[language].detection),
    }))
    .sort((left, right) => right.score - left.score);
  if ((ranked[0]?.score ?? 0) < 4) return null;
  if ((ranked[0]?.score ?? 0) === (ranked[1]?.score ?? -1)) return null;
  return ranked[0]?.language ?? null;
}

export function resolveHeuristicLanguage(
  language: string | null,
  content: string,
): HeuristicLanguageResolution {
  const declared = baseLanguage(language);
  const detected = detectedLanguage(content);
  if (detected && detected !== declared) {
    return {
      language: declared ?? detected,
      heuristicLanguage: detected,
      supported: true,
      source: 'content',
    };
  }
  if (declared && supported.has(declared)) {
    return {
      language: declared,
      heuristicLanguage: declared as HeuristicLanguage,
      supported: true,
      source: 'metadata',
    };
  }
  if (detected) {
    return {
      language: declared ?? detected,
      heuristicLanguage: detected,
      supported: true,
      source: 'content',
    };
  }
  return {
    language: declared,
    heuristicLanguage: null,
    supported: false,
    source: declared ? 'metadata' : 'unknown',
  };
}

export function matchesLanguageMarker(
  value: string,
  marker: HeuristicMarker,
  resolution: HeuristicLanguageResolution,
): boolean {
  if (!resolution.heuristicLanguage) return false;
  return unicodeAwarePattern(
    packs[resolution.heuristicLanguage].markers[marker],
    false,
  ).test(value);
}

export function countLanguageMarkers(
  value: string,
  marker: HeuristicMarker,
  resolution: HeuristicLanguageResolution,
): number {
  if (!resolution.heuristicLanguage) return 0;
  return occurrences(
    value,
    packs[resolution.heuristicLanguage].markers[marker],
  );
}
