import {
  applyAttentionProgress,
  getEligibleOutcomeSession,
  markOutcomePromptShown,
  recordMaterialOutcome,
} from '../../attention/storage';
import { recordMaterialActualUtility } from '../../memory/material-memory';
import {
  ATTENTION_SESSION_GET_PROGRESS_TYPE,
  type AttentionSessionRecord,
  type MaterialOutcome,
} from '../../shared/types';
import {
  getUtilityFeedbackStats,
  recordActualUtility,
} from '../../utility/storage';
import { getElement, setPopupStatus } from '../dom';
import { isAttentionProgressResponse } from '../guards';

export interface FeedbackControllerOptions {
  status: HTMLParagraphElement;
}

export class FeedbackController {
  private readonly prompt = getElement<HTMLElement>('outcome-prompt');
  private readonly promptNote = getElement<HTMLParagraphElement>(
    'outcome-prompt-note',
  );
  private readonly stats = getElement<HTMLParagraphElement>('outcome-stats');
  private readonly utilityInput =
    getElement<HTMLInputElement>('actual-utility');
  private readonly utilityValue = getElement<HTMLOutputElement>(
    'actual-utility-value',
  );
  private readonly saveButton = getElement<HTMLButtonElement>(
    'save-actual-utility',
  );
  private activeSession: AttentionSessionRecord | null = null;
  private markedSessionId: string | null = null;

  constructor(private readonly options: FeedbackControllerOptions) {
    this.utilityInput.addEventListener('input', () => {
      this.utilityValue.value = this.utilityInput.value;
    });
    this.saveButton.addEventListener('click', () => void this.save());
  }

  resetForCapture(): void {
    this.prompt.hidden = true;
    this.activeSession = null;
  }

  async syncProgress(tabId: number): Promise<void> {
    const response: unknown = await chrome.tabs.sendMessage(tabId, {
      type: ATTENTION_SESSION_GET_PROGRESS_TYPE,
    });
    if (!isAttentionProgressResponse(response) || !response.progress) return;
    await applyAttentionProgress(response.progress);
  }

  async restorePrompt(pageUrl: string): Promise<void> {
    const session = await getEligibleOutcomeSession(pageUrl);
    this.activeSession = session;
    if (!session || session.expected.predictedUtility === null) {
      this.prompt.hidden = true;
      return;
    }
    this.utilityInput.value = String(
      Math.round(session.expected.predictedUtility / 5) * 5,
    );
    this.utilityValue.value = this.utilityInput.value;
    this.promptNote.textContent = `Прогноз был ${session.expected.predictedUtility}%. Ваша оценка займёт один жест.`;
    this.saveButton.disabled = false;
    this.prompt.hidden = false;
    if (this.markedSessionId !== session.id) {
      this.markedSessionId = session.id;
      await markOutcomePromptShown(session.id);
    }
  }

  async refreshStats(): Promise<void> {
    const stats = await getUtilityFeedbackStats();
    if (stats.total === 0) {
      this.stats.hidden = true;
      return;
    }
    this.stats.textContent = `Оценок: ${stats.total} · средняя ошибка: ${stats.averageError}`;
    this.stats.hidden = false;
  }

  private async save(): Promise<void> {
    if (!this.activeSession) return;
    this.saveButton.disabled = true;
    try {
      const actualUtility = Number(this.utilityInput.value);
      const utilityRecord = await recordActualUtility(
        this.activeSession,
        actualUtility,
      );
      await recordMaterialActualUtility(
        this.activeSession.url,
        this.activeSession.title,
        actualUtility,
        utilityRecord.recordedAt,
        chrome.storage.local,
        this.activeSession.scenario,
      );
      const outcome: MaterialOutcome =
        actualUtility >= 70 ? 'yes' : actualUtility >= 40 ? 'partial' : 'no';
      await recordMaterialOutcome(this.activeSession.id, outcome);
      await this.refreshStats();
      this.promptNote.textContent = 'Actual utility сохранена локально.';
      window.setTimeout(() => {
        this.prompt.hidden = true;
      }, 900);
    } catch {
      this.saveButton.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        'Не удалось сохранить actual utility.',
      );
    }
  }
}
