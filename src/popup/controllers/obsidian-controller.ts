import type { UiLanguage } from '../../i18n/ui';
import { loadObsidianSettings } from '../../obsidian/storage';
import { getElement } from '../dom';

interface ObsidianCopy {
  description: string;
  disconnected: string;
  connected: string;
}

const ru: ObsidianCopy = {
  description: 'Собственные заметки для оценки новизны',
  disconnected: 'Не подключён',
  connected: '{count} заметок',
};

const en: ObsidianCopy = {
  description: 'Your own notes for novelty estimates',
  disconnected: 'Not connected',
  connected: '{count} notes',
};

const overrides: Partial<Record<UiLanguage, Partial<ObsidianCopy>>> = {
  de: {
    description: 'Eigene Notizen für Neuheitsschätzungen',
    disconnected: 'Nicht verbunden',
    connected: '{count} Notizen',
  },
  es: {
    description: 'Notas propias para estimar la novedad',
    disconnected: 'No conectado',
    connected: '{count} notas',
  },
  fr: {
    description: 'Vos notes pour estimer la nouveauté',
    disconnected: 'Non connecté',
    connected: '{count} notes',
  },
  it: {
    description: 'Note personali per stimare la novità',
    disconnected: 'Non collegato',
    connected: '{count} note',
  },
  zh: {
    description: '用自己的笔记估算新颖度',
    disconnected: '未连接',
    connected: '{count} 条笔记',
  },
  ar: {
    description: 'ملاحظاتك الخاصة لتقدير الجِدّة',
    disconnected: 'غير متصل',
    connected: '{count} ملاحظة',
  },
  hi: {
    description: 'नवीनता अनुमान के लिए आपके अपने नोट्स',
    disconnected: 'कनेक्ट नहीं है',
    connected: '{count} नोट्स',
  },
};

function copyFor(language: UiLanguage): ObsidianCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

export interface ObsidianControllerOptions {
  getLanguage: () => UiLanguage;
}

export class ObsidianController {
  private readonly openButton = getElement<HTMLButtonElement>(
    'open-obsidian-settings',
  );
  private readonly sourceStatus = getElement<HTMLElement>(
    'obsidian-home-status',
  );
  private readonly description = getElement<HTMLElement>(
    'obsidian-navigation-description',
  );

  constructor(private readonly options: ObsidianControllerOptions) {
    this.openButton.addEventListener('click', () => void this.open());
  }

  translate(): void {
    this.description.textContent = copyFor(
      this.options.getLanguage(),
    ).description;
  }

  async refresh(): Promise<void> {
    this.translate();
    const copy = copyFor(this.options.getLanguage());
    const settings = await loadObsidianSettings();
    this.sourceStatus.textContent = settings.connected
      ? copy.connected.replace('{count}', String(settings.noteCount))
      : copy.disconnected;
  }

  private async open(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL('obsidian.html') });
    window.close();
  }
}
