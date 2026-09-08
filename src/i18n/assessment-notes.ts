import type { UiLanguage } from './ui';
const copy: Record<UiLanguage, [string, string, string, string]> = {
  en: [
    'Not enough context yet',
    'The text does not yet show a clear connection to your task.',
    'Only part of the article was assessed',
    'The assessment and passages use the same excerpts. Important context may be missing.',
  ],
  ru: [
    'Пока неясно',
    'По тексту пока неясно, чем статья поможет с вашей задачей.',
    'Оценена часть статьи',
    'Оценка и фрагменты основаны на одних и тех же частях текста. В пропущенных местах может быть важный контекст.',
  ],
  de: [
    'Noch nicht genug Kontext',
    'Der Text zeigt noch keinen klaren Bezug zu deiner Aufgabe.',
    'Nur ein Teil des Artikels wurde bewertet',
    'Bewertung und Textstellen beruhen auf denselben Auszügen. Wichtiger Kontext könnte fehlen.',
  ],
  es: [
    'Aún falta contexto',
    'El texto aún no muestra una relación clara con tu tarea.',
    'Solo se evaluó parte del artículo',
    'La evaluación y los pasajes usan los mismos extractos. Puede faltar contexto importante.',
  ],
  fr: [
    'Pas encore assez de contexte',
    'Le lien entre le texte et votre tâche reste incertain.',
    'Seule une partie de l’article a été évaluée',
    'L’évaluation et les passages utilisent les mêmes extraits. Un contexte important peut manquer.',
  ],
  it: [
    'Contesto ancora insufficiente',
    'Il legame tra il testo e il tuo obiettivo non è ancora chiaro.',
    'È stata valutata solo una parte dell’articolo',
    'Valutazione e passaggi usano gli stessi estratti. Potrebbe mancare un contesto importante.',
  ],
  zh: [
    '暂时无法判断',
    '尚未从正文中找到与您任务的明确联系。',
    '仅评估了文章的一部分',
    '评估与片段基于同一组原文。可能遗漏重要背景。',
  ],
  ar: [
    'السياق غير كافٍ بعد',
    'لم يتضح بعد كيف يساعد النص في مهمتك.',
    'تم تقييم جزء من المقال فقط',
    'يعتمد التقييم والمقاطع على الأجزاء نفسها. قد يكون هناك سياق مهم مفقود.',
  ],
  hi: [
    'अभी पर्याप्त संदर्भ नहीं',
    'पाठ से अभी स्पष्ट नहीं है कि यह आपके काम में कैसे मदद करेगा।',
    'लेख के केवल एक हिस्से का आकलन हुआ',
    'आकलन और अंश एक ही चुने हुए पाठ पर आधारित हैं। महत्वपूर्ण संदर्भ छूट सकता है।',
  ],
};
const keys = { unclear: 0, goal: 1, partial: 2, partialNote: 3 } as const;
export function assessmentNote(
  language: UiLanguage,
  key: keyof typeof keys,
): string {
  return copy[language][keys[key]];
}
