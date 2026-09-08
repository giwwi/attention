import type { UiLanguage } from '../i18n/ui';
const copy = {
  en: [
    'See an example first',
    'A made-up example, not an assessment of your profile.',
    'Goal: reduce response time',
    'Faster responses',
    'The introduction explains what response time means.',
    'Reuse results for repeated requests to avoid doing the same work again. However, this only helps when the stored result is still valid.',
    'Show the useful passage',
    'The passage relates to the goal and keeps its limitation. Your data is not used in this example.',
  ],
  ru: [
    'Сначала посмотреть пример',
    'Учебный пример, а не оценка вашего профиля.',
    'Задача: сократить время ответа',
    'Как получать ответы быстрее',
    'Во вступлении объясняется, что такое время ответа.',
    'Используйте сохранённый результат для повторяющихся запросов, чтобы не выполнять одну работу заново. Однако это помогает только тогда, когда сохранённый результат ещё актуален.',
    'Показать полезный фрагмент',
    'Фрагмент связан с задачей и включает ограничение. Ваши данные в этом примере не используются.',
  ],
  de: [
    'Zuerst ein Beispiel ansehen',
    'Ein erfundenes Beispiel, keine Bewertung deines Profils.',
    'Ziel: Antwortzeit verkürzen',
    'Schnellere Antworten',
    'Die Einleitung erklärt, was Antwortzeit bedeutet.',
    'Nutze gespeicherte Ergebnisse für wiederholte Anfragen, um dieselbe Arbeit nicht erneut auszuführen. Das hilft jedoch nur, solange das gespeicherte Ergebnis noch gültig ist.',
    'Nützliche Textstelle zeigen',
    'Die Textstelle passt zum Ziel und enthält die Einschränkung. Deine Daten werden hier nicht verwendet.',
  ],
  es: [
    'Ver primero un ejemplo',
    'Un ejemplo ficticio, no una evaluación de tu perfil.',
    'Objetivo: reducir el tiempo de respuesta',
    'Respuestas más rápidas',
    'La introducción explica qué es el tiempo de respuesta.',
    'Reutiliza resultados guardados para las consultas repetidas y evita hacer el mismo trabajo de nuevo. Sin embargo, esto solo ayuda si el resultado guardado sigue siendo válido.',
    'Mostrar el pasaje útil',
    'El pasaje está relacionado con el objetivo e incluye su limitación. Este ejemplo no usa tus datos.',
  ],
  fr: [
    'Voir d’abord un exemple',
    'Un exemple fictif, pas une évaluation de votre profil.',
    'Objectif : réduire le temps de réponse',
    'Des réponses plus rapides',
    'L’introduction explique ce qu’est le temps de réponse.',
    'Réutilisez les résultats enregistrés pour les demandes répétées afin de ne pas refaire le même travail. Toutefois, cela n’aide que si le résultat enregistré reste valide.',
    'Afficher le passage utile',
    'Le passage concerne l’objectif et conserve sa limite. Cet exemple n’utilise pas vos données.',
  ],
  it: [
    'Guarda prima un esempio',
    'Un esempio inventato, non una valutazione del tuo profilo.',
    'Obiettivo: ridurre il tempo di risposta',
    'Risposte più rapide',
    'L’introduzione spiega che cosa sia il tempo di risposta.',
    'Riutilizza i risultati salvati per le richieste ripetute, evitando di svolgere di nuovo lo stesso lavoro. Tuttavia, questo aiuta solo se il risultato salvato è ancora valido.',
    'Mostra il passaggio utile',
    'Il passaggio riguarda l’obiettivo e include il suo limite. Questo esempio non usa i tuoi dati.',
  ],
  zh: [
    '先看一个示例',
    '虚构的教学示例，并非对您个人资料的评估。',
    '目标：缩短响应时间',
    '更快地获得响应',
    '引言解释了响应时间的含义。',
    '对于重复请求，复用已保存的结果，避免重复执行相同的工作。不过，这只在已保存的结果仍然有效时才有帮助。',
    '显示有用片段',
    '片段与目标相关，并保留了适用限制。本示例不使用您的数据。',
  ],
  ar: [
    'شاهد مثالًا أولًا',
    'مثال تعليمي متخيّل، وليس تقييمًا لملفك الشخصي.',
    'الهدف: تقليل زمن الاستجابة',
    'استجابات أسرع',
    'تشرح المقدمة معنى زمن الاستجابة.',
    'أعد استخدام النتائج المحفوظة للطلبات المتكررة لتجنب أداء العمل نفسه مجددًا. لكن هذا يفيد فقط عندما تظل النتيجة المحفوظة صالحة.',
    'إظهار المقطع المفيد',
    'يرتبط المقطع بالهدف ويحتفظ بالقيد المذكور. لا يستخدم هذا المثال بياناتك.',
  ],
  hi: [
    'पहले एक उदाहरण देखें',
    'यह काल्पनिक उदाहरण है, आपके प्रोफ़ाइल का आकलन नहीं।',
    'लक्ष्य: जवाब आने का समय कम करना',
    'तेज़ जवाब',
    'भूमिका बताती है कि जवाब आने के समय का क्या अर्थ है।',
    'बार-बार आने वाले अनुरोधों के लिए सहेजे गए परिणाम दोबारा इस्तेमाल करें, ताकि वही काम फिर न करना पड़े। लेकिन यह तभी मदद करता है जब सहेजा गया परिणाम अभी भी सही हो।',
    'उपयोगी अंश दिखाएँ',
    'अंश लक्ष्य से जुड़ा है और उसकी सीमा भी बताता है। इस उदाहरण में आपके डेटा का उपयोग नहीं होता।',
  ],
} as const;

/** Entirely static and ephemeral: usable before a vault or profile exists. */
export function createProfileDemo(language: UiLanguage): HTMLDetailsElement {
  const t = copy[language];
  const root = document.createElement('details');
  root.className = 'profile-example';
  root.dataset.profileDemo = 'true';
  root.style.cssText =
    'margin:16px 0;font-size:14px;line-height:1.5;text-align:start';
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: string,
  ) => {
    const result = document.createElement(tag);
    result.textContent = text;
    return result;
  };
  const summary = node('summary', t[0]);
  summary.style.cssText = 'cursor:pointer;font-weight:600;padding:8px 0';
  const note = node('p', t[1]);
  note.style.fontSize = '12px';
  const goal = node('p', t[2]);
  goal.style.fontWeight = '650';
  const article = document.createElement('article');
  article.style.cssText =
    'padding:14px;border:1px solid #869a8d;border-radius:10px';
  const context = node('p', t[4]);
  const passage = node('p', t[5]);
  passage.tabIndex = -1;
  article.append(node('h3', t[3]), context, passage);
  const action = node('button', t[6]);
  action.type = 'button';
  action.style.cssText = 'margin-top:12px;min-height:40px;cursor:pointer';
  const status = node('p', t[7]);
  status.setAttribute('role', 'status');
  status.hidden = true;
  action.addEventListener('click', () => {
    passage.style.cssText =
      'background:#e2f4a5;color:#193528;padding:10px;border-inline-start:3px solid #246349';
    status.hidden = false;
    passage.focus();
  });
  root.append(summary, note, goal, article, action, status);
  return root;
}
