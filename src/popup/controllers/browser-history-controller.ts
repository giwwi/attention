import {
  BROWSER_HISTORY_IMPORT_TYPE,
  type BrowserHistoryImportResponse,
} from '../../history/messages';
import {
  clearBrowserHistoryEvidence,
  loadBrowserHistorySettings,
} from '../../history/storage';
import type { HistoryLookbackDays } from '../../history/evidence';
import { getElement } from '../dom';

type HistoryScreenOrigin = 'profile' | 'settings';

function isImportResponse(
  value: unknown,
): value is BrowserHistoryImportResponse {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as Record<string, unknown>).ok === 'boolean';
}

export class BrowserHistoryController {
  private readonly root = getElement<HTMLElement>('browser-history-setup');
  private readonly profileRoot = getElement<HTMLElement>('profile-onboarding');
  private readonly settingsHome = getElement<HTMLElement>('settings-home');
  private readonly sourceButton = getElement<HTMLButtonElement>(
    'open-browser-history',
  );
  private readonly closeButton = getElement<HTMLButtonElement>(
    'close-browser-history',
  );
  private readonly importButton = getElement<HTMLButtonElement>(
    'import-browser-history',
  );
  private readonly deleteButton = getElement<HTMLButtonElement>(
    'delete-browser-history',
  );
  private readonly status = getElement<HTMLParagraphElement>(
    'browser-history-status',
  );
  private readonly result = getElement<HTMLElement>('browser-history-result');
  private readonly summary = getElement<HTMLParagraphElement>(
    'browser-history-summary',
  );
  private origin: HistoryScreenOrigin = 'settings';

  initialize(): void {
    this.sourceButton.addEventListener('click', () => this.open('profile'));
    this.closeButton.addEventListener('click', () => this.close());
    this.importButton.addEventListener('click', () => {
      void this.importHistory();
    });
    this.deleteButton.addEventListener('click', () => {
      void this.deleteHistory();
    });
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[name="history-period"]',
    )) {
      input.addEventListener('change', () => this.updateImportLabel());
    }
    this.updateImportLabel();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const settings = await loadBrowserHistorySettings();
    if (!settings?.lastProcessedAt) {
      this.deleteButton.hidden = true;
      this.result.hidden = true;
      return;
    }
    this.summary.textContent = `Использовано ${settings.processedUrlCount} страниц и ${settings.totalVisitCount} посещений за последние ${settings.lookbackDays} дней. Исключено чувствительных или служебных адресов: ${settings.excludedUrlCount}.${settings.permissionRetained ? ' Временное разрешение Chrome не удалось отозвать автоматически; удалите сигналы, чтобы повторить отзыв.' : ''}`;
    this.result.hidden = false;
    this.deleteButton.hidden = false;
    const selected = document.querySelector<HTMLInputElement>(
      `input[name="history-period"][value="${settings.lookbackDays}"]`,
    );
    if (selected) selected.checked = true;
    this.updateImportLabel();
  }

  private open(origin: HistoryScreenOrigin): void {
    this.origin = origin;
    this.profileRoot.hidden = true;
    this.settingsHome.hidden = true;
    this.root.hidden = false;
    document.body.classList.add('history-flow-active');
    void this.refresh();
  }

  private close(): void {
    this.root.hidden = true;
    document.body.classList.remove('history-flow-active');
    if (this.origin === 'profile') this.profileRoot.hidden = false;
    else this.settingsHome.hidden = false;
  }

  private selectedLookback(): HistoryLookbackDays {
    const checked = document.querySelector<HTMLInputElement>(
      'input[name="history-period"]:checked',
    );
    const value = Number(checked?.value);
    return value === 7 || value === 90 ? value : 30;
  }

  private updateImportLabel(): void {
    this.importButton.textContent = `Разрешить и обработать последние ${this.selectedLookback()} дней`;
  }

  private setStatus(message: string, state: 'default' | 'error' = 'default') {
    this.status.textContent = message;
    this.status.dataset.state = state;
  }

  private async importHistory(): Promise<void> {
    const lookbackDays = this.selectedLookback();
    this.importButton.disabled = true;
    this.setStatus('Проверяем разрешение Chrome…');
    try {
      const permission: chrome.permissions.Permissions = {
        permissions: ['history'],
      };
      const alreadyGranted = await chrome.permissions.contains(permission);
      const granted =
        alreadyGranted || (await chrome.permissions.request(permission));
      if (!granted) {
        this.setStatus(
          'Доступ не предоставлен. История не читалась и ничего не изменилось.',
          'error',
        );
        return;
      }
      this.setStatus('Обрабатываем историю локально…');
      const response: unknown = await chrome.runtime.sendMessage({
        type: BROWSER_HISTORY_IMPORT_TYPE,
        lookbackDays,
      });
      if (!isImportResponse(response) || !response.ok) {
        const error = isImportResponse(response)
          ? response.error
          : 'history_import_failed';
        throw new Error(error ?? 'history_import_failed');
      }
      this.setStatus(
        response.permissionRevoked === false
          ? 'Готово. Сигналы сохранены локально; доступ Chrome не удалось отозвать автоматически.'
          : 'Готово. Сигналы сохранены локально, временный доступ к истории отозван.',
      );
      await this.refresh();
    } catch {
      this.setStatus(
        'Не удалось обработать историю. Временное разрешение будет отозвано.',
        'error',
      );
      await chrome.permissions
        .remove({ permissions: ['history'] })
        .catch(() => false);
    } finally {
      this.importButton.disabled = false;
    }
  }

  private async deleteHistory(): Promise<void> {
    this.deleteButton.disabled = true;
    try {
      await clearBrowserHistoryEvidence();
      await chrome.permissions
        .remove({ permissions: ['history'] })
        .catch(() => false);
      this.setStatus('Сигналы истории удалены, разрешение отозвано.');
      await this.refresh();
    } finally {
      this.deleteButton.disabled = false;
    }
  }
}
