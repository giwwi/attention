import { privateStorage } from '../../vault/storage';
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
import { popupText } from '../../i18n/popup';
import { uiText, type UiLanguage } from '../../i18n/ui';
import {
  commitDataOperation,
  DataOperationCancelledError,
  type DataOperation,
} from '../../privacy/data-operations';

export interface FeedbackControllerOptions {
  status: HTMLParagraphElement;
  getLanguage: () => UiLanguage;
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
  private activeOperation: DataOperation | null = null;
  private revision = 0;
  private markedSessionId: string | null = null;

  constructor(private readonly options: FeedbackControllerOptions) {
    this.utilityInput.addEventListener('input', () => {
      this.utilityValue.value = this.utilityInput.value;
    });
    this.saveButton.addEventListener('click', () => void this.save());
  }

  resetForCapture(): void {
    this.revision += 1;
    this.prompt.hidden = true;
    this.activeSession = null;
    this.activeOperation = null;
    this.markedSessionId = null;
  }

  async syncProgress(tabId: number, operation: DataOperation): Promise<void> {
    const response: unknown = await chrome.tabs.sendMessage(tabId, {
      type: ATTENTION_SESSION_GET_PROGRESS_TYPE,
    });
    if (!isAttentionProgressResponse(response) || !response.progress) return;
    await commitDataOperation(operation, () =>
      applyAttentionProgress(response.progress!),
    );
  }

  async restorePrompt(
    pageUrl: string,
    operation: DataOperation,
  ): Promise<void> {
    const revision = this.revision;
    const session = await getEligibleOutcomeSession(pageUrl);
    if (revision !== this.revision) return;
    this.activeSession = session;
    this.activeOperation = operation;
    if (!session || session.expected.predictedUtility === null) {
      this.prompt.hidden = true;
      return;
    }
    this.utilityInput.value = String(
      Math.round(session.expected.predictedUtility / 5) * 5,
    );
    this.utilityValue.value = this.utilityInput.value;
    this.promptNote.textContent = popupText(
      this.options.getLanguage(),
      'outcomeNote',
      { count: session.expected.predictedUtility },
    );
    this.saveButton.disabled = false;
    this.prompt.hidden = false;
    if (this.markedSessionId !== session.id) {
      this.markedSessionId = session.id;
      await commitDataOperation(operation, () =>
        markOutcomePromptShown(session.id),
      );
    }
  }

  async refreshStats(): Promise<void> {
    const stats = await getUtilityFeedbackStats();
    if (stats.total === 0) {
      this.stats.hidden = true;
      return;
    }
    this.stats.textContent = popupText(
      this.options.getLanguage(),
      'outcomeStats',
      { count: stats.total, error: stats.averageError ?? 0 },
    );
    this.stats.hidden = false;
  }

  private async save(): Promise<void> {
    if (!this.activeSession || !this.activeOperation) return;
    const session = this.activeSession;
    const operation = this.activeOperation;
    this.saveButton.disabled = true;
    try {
      await commitDataOperation(operation, async () => {
        const actualUtility = Number(this.utilityInput.value);
        const utilityRecord = await recordActualUtility(session, actualUtility);
        await recordMaterialActualUtility(
          session.url,
          session.title,
          actualUtility,
          utilityRecord.recordedAt,
          privateStorage,
          session.scenario,
          {
            source: utilityRecord.source,
            prediction: utilityRecord.prediction,
            outcome: utilityRecord.outcome,
          },
        );
        const outcome: MaterialOutcome =
          actualUtility >= 70 ? 'yes' : actualUtility >= 40 ? 'partial' : 'no';
        await recordMaterialOutcome(
          session.id,
          outcome,
          privateStorage,
          new Date(),
          'slider',
        );
      });
      await this.refreshStats();
      this.promptNote.textContent = uiText(
        this.options.getLanguage(),
        'feedbackSaved',
      );
      window.setTimeout(() => {
        this.prompt.hidden = true;
      }, 900);
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      this.saveButton.disabled = false;
      setPopupStatus(
        this.options.status,
        'error',
        uiText(this.options.getLanguage(), 'outcomeError'),
      );
    }
  }
}
