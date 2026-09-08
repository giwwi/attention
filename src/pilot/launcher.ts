import type { UiLanguage } from '../i18n/ui';

const labels: Record<UiLanguage, string> = {
  ru: 'Добровольный пилот · RU / EN',
  en: 'Voluntary pilot · RU / EN',
  de: 'Freiwillige Pilotstudie · RU / EN',
  es: 'Piloto voluntario · RU / EN',
  fr: 'Pilote volontaire · RU / EN',
  it: 'Prova volontaria · RU / EN',
  zh: '自愿试用研究 · RU / EN',
  ar: 'تجربة تطوعية · RU / EN',
  hi: 'स्वैच्छिक परीक्षण · RU / EN',
};

export function translatePilotLauncher(language: UiLanguage): void {
  const button = document.getElementById('open-voluntary-pilot');
  if (button) button.textContent = labels[language];
}

export function installPilotLauncher(): void {
  document
    .getElementById('open-voluntary-pilot')
    ?.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      void (async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const url = new URL(chrome.runtime.getURL('pilot.html'));
        if (tab?.id !== undefined)
          url.searchParams.set('sourceTab', String(tab.id));
        await chrome.tabs.create({ url: url.href });
      })();
    });
}
