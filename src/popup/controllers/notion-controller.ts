import type { UiLanguage } from '../../i18n/ui';
import { loadNotionSettings } from '../../notion/storage';
import { getElement } from '../dom';

interface NotionCopy {
  description: string;
  disconnected: string;
  connected: string;
}

const ru: NotionCopy = {
  description: 'Выбранные страницы для оценки новизны',
  disconnected: 'Не подключён',
  connected: '{count} страниц',
};

const en: NotionCopy = {
  description: 'Selected pages for novelty estimates',
  disconnected: 'Not connected',
  connected: '{count} pages',
};

const overrides: Partial<Record<UiLanguage, Partial<NotionCopy>>> = {
  de: {
    description: 'Ausgewählte Seiten für Neuheitsschätzungen',
    disconnected: 'Nicht verbunden',
    connected: '{count} Seiten',
  },
  es: {
    description: 'Páginas elegidas para estimar la novedad',
    disconnected: 'No conectado',
    connected: '{count} páginas',
  },
  fr: {
    description: 'Pages choisies pour estimer la nouveauté',
    disconnected: 'Non connecté',
    connected: '{count} pages',
  },
  it: {
    description: 'Pagine scelte per stimare la novità',
    disconnected: 'Non collegato',
    connected: '{count} pagine',
  },
  zh: {
    description: '用于估算新颖度的已选页面',
    disconnected: '未连接',
    connected: '{count} 个页面',
  },
  ar: {
    description: 'صفحات محددة لتقدير الجِدّة',
    disconnected: 'غير متصل',
    connected: '{count} صفحة',
  },
  hi: {
    description: 'नवीनता अनुमान के लिए चुने गए पेज',
    disconnected: 'कनेक्ट नहीं है',
    connected: '{count} पेज',
  },
};

function copyFor(language: UiLanguage): NotionCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

export class NotionController {
  private readonly openButton = getElement<HTMLButtonElement>(
    'open-notion-settings',
  );
  private readonly sourceStatus = getElement<HTMLElement>('notion-home-status');
  private readonly description = getElement<HTMLElement>(
    'notion-navigation-description',
  );

  constructor(private readonly getLanguage: () => UiLanguage) {
    this.openButton.addEventListener('click', () => void this.open());
  }

  translate(): void {
    this.description.textContent = copyFor(this.getLanguage()).description;
  }

  async refresh(): Promise<void> {
    this.translate();
    const settings = await loadNotionSettings();
    const copy = copyFor(this.getLanguage());
    this.sourceStatus.textContent = settings.connected
      ? copy.connected.replace('{count}', String(settings.pageCount))
      : copy.disconnected;
  }

  private async open(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('notion.html') });
    window.close();
  }
}
