import { uiText, type UiLanguage } from '../../i18n/ui';
import type { PageCapture, SavedMaterial } from '../../shared/types';
import { closeExtensionPopup, getElement, setPopupStatus } from '../dom';
import { isSavedMaterial } from '../guards';
import {
  isOpenableMaterialUrl,
  removeSavedMaterial,
  upsertSavedMaterial,
} from '../saved-materials';
import { SAVED_MATERIALS_KEY } from '../storage-keys';

export interface SavedMaterialsControllerOptions {
  status: HTMLParagraphElement;
  settingsHome: HTMLElement;
  aiSettingsPanel: HTMLElement;
  readwiseSettingsPanel: HTMLElement;
  privacySettingsPanel: HTMLElement;
  result: HTMLElement;
  getLanguage: () => UiLanguage;
  isMainStarted: () => boolean;
}

export class SavedMaterialsController {
  private readonly openButton = getElement<HTMLButtonElement>(
    'open-saved-materials',
  );
  private readonly count = getElement<HTMLElement>('saved-materials-count');
  private readonly view = getElement<HTMLElement>('saved-materials-view');
  private readonly closeButton = getElement<HTMLButtonElement>(
    'close-saved-materials',
  );
  private readonly empty = getElement<HTMLParagraphElement>(
    'saved-materials-empty',
  );
  private readonly list = getElement<HTMLElement>('saved-materials-list');

  constructor(private readonly options: SavedMaterialsControllerOptions) {
    this.bindEvents();
  }

  get isVisible(): boolean {
    return !this.view.hidden;
  }

  async refresh(): Promise<SavedMaterial[]> {
    const saved = await this.load();
    this.render(saved);
    return saved;
  }

  hide(): void {
    this.view.hidden = true;
    this.options.result.hidden = true;
    if (this.options.isMainStarted()) this.options.settingsHome.hidden = false;
    this.openButton.setAttribute('aria-expanded', 'false');
  }

  async save(capture: PageCapture): Promise<void> {
    const saved = await this.load();
    const next = upsertSavedMaterial(saved, capture, new Date().toISOString());

    while (next.length > 0) {
      try {
        await chrome.storage.local.set({ [SAVED_MATERIALS_KEY]: next });
        this.render(next);
        return;
      } catch {
        next.pop();
      }
    }
    throw new Error('Недостаточно места для сохранения материала.');
  }

  private bindEvents(): void {
    this.openButton.addEventListener('click', () => {
      if (this.view.hidden) {
        void this.show().catch(() => {
          setPopupStatus(
            this.options.status,
            'error',
            'Не удалось открыть сохранённые материалы.',
          );
        });
      } else {
        this.hide();
      }
    });
    this.closeButton.addEventListener('click', () => this.hide());
  }

  private async load(): Promise<SavedMaterial[]> {
    const stored = await chrome.storage.local.get(SAVED_MATERIALS_KEY);
    const value: unknown = stored[SAVED_MATERIALS_KEY];
    return Array.isArray(value) ? value.filter(isSavedMaterial) : [];
  }

  private formatSavedAt(value: string): string {
    const language = this.options.getLanguage();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return uiText(language, 'savedEarlier');
    }
    return new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'short',
    }).format(date);
  }

  private render(saved: SavedMaterial[]): void {
    const language = this.options.getLanguage();
    this.list.replaceChildren();
    this.count.textContent = String(saved.length);
    this.empty.hidden = saved.length > 0;

    for (const material of saved) {
      const card = document.createElement('article');
      card.className = 'saved-material';
      const copy = document.createElement('div');
      copy.className = 'saved-material-copy';
      const source = document.createElement('p');
      source.className = 'saved-material-source';
      source.textContent = material.capture.siteName;
      const title = document.createElement('h3');
      title.textContent = material.capture.title || 'Материал без заголовка';
      const savedAt = document.createElement('p');
      savedAt.className = 'saved-material-time';
      savedAt.textContent = this.formatSavedAt(material.savedAt);
      copy.append(source, title, savedAt);

      const actions = document.createElement('div');
      actions.className = 'saved-material-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = uiText(language, 'open');
      open.disabled = !isOpenableMaterialUrl(material.capture.url);
      open.addEventListener('click', () => {
        void this.open(material, open);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = uiText(language, 'delete');
      remove.setAttribute(
        'aria-label',
        `Удалить «${material.capture.title || 'материал'}»`,
      );
      remove.addEventListener('click', () => {
        void this.delete(material.capture.url, remove);
      });
      actions.append(open, remove);
      card.append(copy, actions);
      this.list.append(card);
    }
  }

  private async show(): Promise<void> {
    await this.refresh();
    this.options.settingsHome.hidden = true;
    this.options.aiSettingsPanel.hidden = true;
    this.options.readwiseSettingsPanel.hidden = true;
    this.options.privacySettingsPanel.hidden = true;
    this.view.hidden = false;
    this.options.result.hidden = true;
    this.openButton.setAttribute('aria-expanded', 'true');
    this.view.scrollIntoView({ block: 'start' });
  }

  private async open(
    material: SavedMaterial,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!isOpenableMaterialUrl(material.capture.url)) return;
    button.disabled = true;
    try {
      await chrome.tabs.create({ url: material.capture.url, active: true });
      closeExtensionPopup();
    } catch {
      button.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось открыть сохранённый материал.',
      );
    }
  }

  private async delete(
    pageUrl: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    button.disabled = true;
    try {
      const saved = await this.load();
      const next = removeSavedMaterial(saved, pageUrl);
      await chrome.storage.local.set({ [SAVED_MATERIALS_KEY]: next });
      this.render(next);
      setPopupStatus(
        this.options.status,
        'success',
        'Материал удалён из сохранённых.',
      );
    } catch {
      button.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось удалить материал.',
      );
    }
  }
}
