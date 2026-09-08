import type { UiLanguage } from '../../i18n/ui';
import { notionOAuthConfigured } from '../../notion/config';
import { loadNotionSettings } from '../../notion/storage';
import { getElement } from '../dom';

interface NotionCopy {
  description: string;
  disconnected: string;
  connected: string;
  unavailable: string;
}

const ru: NotionCopy = {
  description: 'Выбранные страницы для оценки новизны',
  disconnected: 'Не подключён',
  connected: '{count} страниц',
  unavailable: 'Подключение недоступно в этой версии',
};

const en: NotionCopy = {
  description: 'Selected pages for novelty estimates',
  disconnected: 'Not connected',
  connected: '{count} pages',
  unavailable: 'Connection unavailable in this version',
};

const overrides: Partial<Record<UiLanguage, Partial<NotionCopy>>> = {
  de: {
    description: 'Ausgewählte Seiten für Neuheitsschätzungen',
    disconnected: 'Nicht verbunden',
    connected: '{count} Seiten',
    unavailable: 'Verbindung in dieser Version nicht verfügbar',
  },
  es: {
    description: 'Páginas elegidas para estimar la novedad',
    disconnected: 'No conectado',
    connected: '{count} páginas',
    unavailable: 'Conexión no disponible en esta versión',
  },
  fr: {
    description: 'Pages choisies pour estimer la nouveauté',
    disconnected: 'Non connecté',
    connected: '{count} pages',
    unavailable: 'Connexion indisponible dans cette version',
  },
  it: {
    description: 'Pagine scelte per stimare la novità',
    disconnected: 'Non collegato',
    connected: '{count} pagine',
    unavailable: 'Connessione non disponibile in questa versione',
  },
  zh: {
    description: '用于估算新颖度的已选页面',
    disconnected: '未连接',
    connected: '{count} 个页面',
    unavailable: '此版本暂不支持连接',
  },
  ar: {
    description: 'صفحات محددة لتقدير الجِدّة',
    disconnected: 'غير متصل',
    connected: '{count} صفحة',
    unavailable: 'الاتصال غير متاح في هذا الإصدار',
  },
  hi: {
    description: 'नवीनता अनुमान के लिए चुने गए पेज',
    disconnected: 'कनेक्ट नहीं है',
    connected: '{count} पेज',
    unavailable: 'इस संस्करण में कनेक्शन उपलब्ध नहीं है',
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
    const copy = copyFor(this.getLanguage());
    this.description.textContent = copy.description;
    if (!notionOAuthConfigured()) {
      this.sourceStatus.textContent = copy.unavailable;
    }
  }

  async refresh(): Promise<void> {
    this.translate();
    const settings = await loadNotionSettings();
    const copy = copyFor(this.getLanguage());
    this.sourceStatus.textContent = !notionOAuthConfigured()
      ? copy.unavailable
      : settings.connected
        ? copy.connected.replace('{count}', String(settings.pageCount))
        : copy.disconnected;
  }

  private async open(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('notion.html') });
    window.close();
  }
}
