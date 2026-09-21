import { captureProfileLabels, profileText } from '../i18n/profile';
import type { UiLanguage } from '../i18n/ui';
import { loadBrowserHistorySettings } from '../history/storage';
import { loadObsidianSettings } from '../obsidian/storage';
import { loadReadwiseSettings } from '../readwise/storage';
import {
  assertDataOperationCurrent,
  beginDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
} from '../privacy/data-operations';
import { privateStorage } from '../vault/storage';
import { OPTIONAL_SOURCES_PENDING_KEY } from './optional-sources-state';
import { OPTIONAL_AI_PENDING_KEY } from './optional-ai-state';

interface OptionalSourcesOptions {
  getLanguage: () => UiLanguage;
  isCurrent: () => boolean;
  openReadwise: (onClose: () => void) => Promise<void>;
  openHistory: (onClose: () => void) => void;
  onComplete: () => void;
}

type Source = 'readwise' | 'obsidian' | 'history';

/** Offers existing opt-in flows; showing this screen never requests access or imports data. */
export class OptionalSources {
  readonly root = document.getElementById('optional-sources')!;
  private readonly translateStatic = captureProfileLabels(this.root);
  private readonly finish = this.root.querySelector<HTMLButtonElement>(
    '#optional-sources-continue',
  )!;
  private readonly error = this.root.querySelector<HTMLElement>(
    '#optional-sources-error',
  )!;
  private active = false;
  private busy = false;
  private revision = 0;
  private connected = { readwise: false, obsidian: false, history: false };

  constructor(private readonly options: OptionalSourcesOptions) {
    for (const source of ['readwise', 'obsidian', 'history'] as const) {
      this.root
        .querySelector(`#optional-${source}`)!
        .addEventListener('click', () => void this.open(source));
    }
    this.finish.addEventListener('click', () => void this.complete());
    window.addEventListener('focus', () => {
      if (this.active && !this.root.hidden)
        void this.refresh().catch(() => this.showError());
    });
  }

  private text(value: string): string {
    return profileText(value, {}, this.options.getLanguage());
  }

  translate(): void {
    this.translateStatic();
    this.render();
  }

  async show(): Promise<void> {
    if (!this.options.isCurrent()) return;
    this.active = true;
    this.root.hidden = false;
    this.error.hidden = true;
    this.translate();
    this.root.querySelector<HTMLElement>('h2')!.focus();
    this.root.scrollIntoView({ block: 'start' });
    // A source-status failure must never prevent skipping the optional step.
    try {
      await this.refresh();
    } catch {
      this.showError();
    }
  }

  private async refresh(): Promise<void> {
    const revision = ++this.revision;
    const [readwise, obsidian, history] = await Promise.all([
      loadReadwiseSettings(),
      loadObsidianSettings(),
      loadBrowserHistorySettings(),
    ]);
    if (!this.active || !this.options.isCurrent() || revision !== this.revision)
      return;
    this.connected = {
      readwise: readwise.connected,
      obsidian: obsidian.connected,
      history: Boolean(history?.lastProcessedAt),
    };
    this.render();
  }

  private render(): void {
    for (const source of ['readwise', 'obsidian', 'history'] as const) {
      const status = this.root.querySelector<HTMLElement>(
        `#optional-${source}-status`,
      )!;
      status.hidden = !this.connected[source];
      status.textContent = this.connected[source] ? this.text('Добавлено') : '';
      this.root.querySelector(`#optional-${source}`)!.textContent = this.text(
        this.connected[source]
          ? 'Настроить'
          : source === 'readwise'
            ? 'Подключить Readwise'
            : source === 'obsidian'
              ? 'Выбрать заметки'
              : 'Выбрать период',
      );
    }
    this.finish.textContent = this.text(
      Object.values(this.connected).some(Boolean)
        ? 'Продолжить'
        : 'Пропустить этот шаг',
    );
  }

  private showError(): void {
    if (!this.active || !this.options.isCurrent()) return;
    this.error.textContent = this.text(
      'Не удалось открыть подключение. Можно пропустить этот шаг и вернуться к нему позже.',
    );
    this.error.hidden = false;
  }

  private async open(source: Source): Promise<void> {
    if (this.busy || !this.active || !this.options.isCurrent()) return;
    this.busy = true;
    this.error.hidden = true;
    const returnHere = (): void => {
      void this.show();
    };
    try {
      if (source === 'obsidian') {
        // Keep the setup tab open; Obsidian's Done button returns here.
        await chrome.tabs.create({
          url: chrome.runtime.getURL('obsidian.html'),
        });
      } else {
        this.root.hidden = true;
        if (source === 'readwise') await this.options.openReadwise(returnHere);
        else this.options.openHistory(returnHere);
      }
    } catch {
      if (this.options.isCurrent()) this.root.hidden = false;
      this.showError();
    } finally {
      this.busy = false;
    }
  }

  private async complete(): Promise<void> {
    if (this.busy || !this.active || !this.options.isCurrent()) return;
    this.busy = true;
    this.finish.disabled = true;
    try {
      const operation = await beginDataOperation();
      await commitDataOperation(operation, async () => {
        // Persist the next step first so closing the tab cannot lose setup.
        await privateStorage.set({ [OPTIONAL_AI_PENDING_KEY]: true });
        await privateStorage.remove(OPTIONAL_SOURCES_PENDING_KEY);
      });
      await assertDataOperationCurrent(operation);
      if (!this.options.isCurrent()) return;
      this.active = false;
      this.revision++;
      this.root.hidden = true;
      this.options.onComplete();
    } catch (error) {
      if (!(error instanceof DataOperationCancelledError)) this.showError();
    } finally {
      this.busy = false;
      this.finish.disabled = false;
    }
  }
}
