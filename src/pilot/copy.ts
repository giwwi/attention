const english: Record<string, string> = {
  retry: 'Retry the Attention assessment',
  backToSetup: 'Choose a different article',
  title: 'What is actually worth reading?',
  intro:
    'A voluntary evaluation for work tasks. One scenario: Work, 15 minutes, technical articles in English or Russian.',
  language: 'Pilot language',
  consentTitle: 'You choose whether to participate',
  privacy:
    'Nothing is sent automatically. Decisions, durations and optional feedback stay in this Chrome. Article text and your goal are used in page memory. Exports omit them, URLs, notes and your profile. Pilot labels do not train the main analyzer.',
  method:
    'First decide using the title and goal, then see Attention. The order is fixed: this is an exploratory comparison, not proof of time savings. You can omit feedback, stop or erase results.',
  consent: 'I voluntarily participate and allow results to be saved locally.',
  enroll: 'Start or continue',
  setupTitle: 'Choose a new article',
  goal: 'What specific work task are you working on?',
  articleTab: 'Open article tab',
  refresh: 'Refresh tabs',
  unseen:
    'I have not read this article or seen its Attention assessment; it is a technical article.',
  useContext:
    'Use my existing local profile, knowledge and calibration. Do not import anything.',
  start: 'Show title only',
  baselineStep: 'STEP 1 · TITLE + GOAL',
  baselinePrompt:
    'What would you do without Attention? The article text and assessment are still hidden.',
  attentionStep: 'STEP 2 · ATTENTION',
  attentionPrompt:
    'What would you do now? Your decision may differ from the recommendation.',
  reviewTitle: 'Optional check against the article',
  audit:
    'This article was randomly selected for a skip audit. If either decision was Skip, checking for missed value is especially helpful. You may decline.',
  readText: 'Read the extracted article here',
  reviewed: 'I read enough to assess usefulness for my task.',
  materialUseful: 'Was the article useful?',
  noAnswer: 'No answer',
  yes: 'Yes',
  partial: 'Partly',
  no: 'No',
  baselineHelpful: 'Did my title-only decision help me spend my time well?',
  attentionHelpful:
    'Did Attention’s recommendation help me spend my time well?',
  saveReview: 'Save optional feedback',
  next: 'Another article / omit feedback',
  results: 'Your local results',
  exportHint:
    'Review the file before sharing it. It includes a random participant ID, decisions, prediction versions and durations. A small sample cannot establish effectiveness.',
  export: 'Download results',
  erase: 'Leave and erase pilot results',
};
const ru: Record<string, string> = {};
export function translatePilot(language: 'ru' | 'en'): void {
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll<HTMLElement>('[data-copy]')) {
    const key = element.dataset.copy!;
    ru[key] ??= element.textContent ?? '';
    element.textContent =
      language === 'en' ? (english[key] ?? ru[key]!) : ru[key]!;
  }
}
export function pilotMessage(
  language: 'ru' | 'en',
  ruText: string,
  enText: string,
): string {
  return language === 'ru' ? ruText : enText;
}
