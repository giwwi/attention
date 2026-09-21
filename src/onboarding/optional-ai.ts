import {
  loadAiAnalyzerSettings,
  saveAiAnalyzerSettings,
  type AiAnalyzerSettings,
} from '../analyzer/settings';
import { captureProfileLabels, profileText } from '../i18n/profile';
import type { UiLanguage } from '../i18n/ui';
import {
  assertDataOperationCurrent,
  beginDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
} from '../privacy/data-operations';
import { saveLocalOnlyMode } from '../privacy/settings';
import { privateStorage } from '../vault/storage';
import { OPTIONAL_AI_PENDING_KEY } from './optional-ai-state';

interface OptionalAiOptions {
  getLanguage: () => UiLanguage;
  isCurrent: () => boolean;
  onComplete: () => void;
}

/** Key setup is optional and never sends a test request or starts an analysis. */
export class OptionalAi {
  readonly root = document.getElementById('optional-ai')!;
  private readonly translateStatic = captureProfileLabels(this.root);
  private readonly key =
    this.root.querySelector<HTMLInputElement>('#optional-ai-key')!;
  private readonly connect = this.root.querySelector<HTMLButtonElement>(
    '#optional-ai-connect',
  )!;
  private readonly skip =
    this.root.querySelector<HTMLButtonElement>('#optional-ai-skip')!;
  private readonly status = this.root.querySelector<HTMLElement>(
    '#optional-ai-status',
  )!;
  private settings: AiAnalyzerSettings | null = null;
  private active = false;
  private busy = false;

  constructor(private readonly options: OptionalAiOptions) {
    this.connect.addEventListener('click', () => void this.complete(true));
    this.skip.addEventListener('click', () => void this.complete(false));
    this.key.addEventListener('input', () =>
      this.key.removeAttribute('aria-invalid'),
    );
  }

  private text(value: string): string {
    return profileText(value, {}, this.options.getLanguage());
  }

  translate(): void {
    this.translateStatic();
    this.connect.textContent = this.text('Подключить и продолжить');
    this.skip.textContent = this.text(
      this.settings ? 'Продолжить с текущими настройками' : 'Пока без AI',
    );
  }

  hide(): void {
    this.active = false;
    this.settings = null;
    this.key.value = '';
    this.root.hidden = true;
  }

  async show(): Promise<void> {
    if (!this.options.isCurrent()) return;
    this.active = true;
    this.root.hidden = false;
    this.key.value = '';
    this.key.removeAttribute('aria-invalid');
    this.status.hidden = true;
    this.translate();
    this.root.querySelector<HTMLElement>('h2')!.focus();
    this.root.scrollIntoView({ block: 'start' });
    try {
      const settings = await loadAiAnalyzerSettings();
      if (!this.active || !this.options.isCurrent()) return;
      this.settings = settings;
      this.translate();
      if (settings)
        this.showStatus(
          'Ключ уже сохранён. Можно оставить его или вставить другой.',
        );
    } catch {
      this.showStatus(
        'Не удалось загрузить настройки AI. Этот шаг можно пропустить.',
      );
    }
  }

  private showStatus(message: string): void {
    if (!this.active || !this.options.isCurrent()) return;
    this.status.textContent = this.text(message);
    this.status.hidden = false;
  }

  private async complete(connect: boolean): Promise<void> {
    if (this.busy || !this.active || !this.options.isCurrent()) return;
    const key = this.key.value.trim();
    if (connect && ((!key && !this.settings) || (key && key.length < 12))) {
      this.showStatus(
        'Скопируйте API-ключ целиком из Vercel или пропустите этот шаг.',
      );
      this.key.setAttribute('aria-invalid', 'true');
      this.key.focus();
      return;
    }
    this.busy = true;
    this.connect.disabled = true;
    this.skip.disabled = true;
    try {
      const operation = await beginDataOperation();
      if (!this.options.isCurrent()) return;
      await commitDataOperation(operation, async () => {
        if (connect) {
          // Use the same encrypted settings and explicit opt-in as the settings page.
          await saveAiAnalyzerSettings(key, this.settings?.model);
          await saveLocalOnlyMode(false);
        }
        await privateStorage.remove(OPTIONAL_AI_PENDING_KEY);
      });
      await assertDataOperationCurrent(operation);
      if (!this.options.isCurrent()) return;
      this.hide();
      this.options.onComplete();
    } catch (error) {
      if (error instanceof DataOperationCancelledError) {
        this.key.value = '';
        this.settings = null;
      } else {
        this.showStatus(
          'Не удалось сохранить настройки. Попробуйте ещё раз или пропустите этот шаг.',
        );
      }
    } finally {
      this.busy = false;
      this.connect.disabled = false;
      this.skip.disabled = false;
    }
  }
}
