import {
  AI_GATEWAY_DEFAULT_MODEL_ID,
  clearAiAnalyzerSettings,
  loadAiAnalyzerSettings,
  saveAiAnalyzerSettings,
  type AiAnalyzerSettings,
} from '../../analyzer/settings';
import { uiText, type UiLanguage } from '../../i18n/ui';
import { popupText } from '../../i18n/popup';
import { getElement, setPopupStatus } from '../dom';
import { saveLocalOnlyMode } from '../../privacy/settings';
import {
  beginDataOperation,
  commitDataOperation,
  DataOperationCancelledError,
} from '../../privacy/data-operations';

export interface AiSettingsControllerOptions {
  status: HTMLParagraphElement;
  settingsHome: HTMLElement;
  savedMaterialsView: HTMLElement;
  readwiseSettingsPanel: HTMLElement;
  privacySettingsPanel: HTMLElement;
  result: HTMLElement;
  getLanguage: () => UiLanguage;
  isMainStarted: () => boolean;
  onSettingsChanged: () => void;
}

export class AiSettingsController {
  private readonly openButton =
    getElement<HTMLButtonElement>('open-ai-settings');
  private readonly homeStatus =
    getElement<HTMLParagraphElement>('ai-home-status');
  private readonly panel = getElement<HTMLElement>('ai-settings');
  private readonly closeButton =
    getElement<HTMLButtonElement>('close-ai-settings');
  private readonly settingsStatus =
    getElement<HTMLParagraphElement>('ai-settings-status');
  private readonly keyInput = getElement<HTMLInputElement>('ai-gateway-key');
  private readonly modelInput =
    getElement<HTMLInputElement>('ai-gateway-model');
  private readonly saveButton =
    getElement<HTMLButtonElement>('save-ai-settings');
  private readonly disconnectButton =
    getElement<HTMLButtonElement>('disconnect-ai');
  private settings: AiAnalyzerSettings | null = null;

  constructor(private readonly options: AiSettingsControllerOptions) {
    this.bindEvents();
  }

  get current(): AiAnalyzerSettings | null {
    return this.settings;
  }

  resetAfterErasure(): void {
    this.settings = null;
    this.keyInput.value = '';
    this.modelInput.value = '';
  }

  get isVisible(): boolean {
    return !this.panel.hidden;
  }

  async refresh(): Promise<AiAnalyzerSettings | null> {
    this.settings = await loadAiAnalyzerSettings();
    this.renderState();
    return this.settings;
  }

  renderState(): void {
    const language = this.options.getLanguage();
    const connected = this.settings !== null;
    const model = this.settings?.model ?? AI_GATEWAY_DEFAULT_MODEL_ID;
    this.openButton.textContent = uiText(
      language,
      connected ? 'change' : 'configure',
    );
    this.openButton.dataset.connected = String(connected);
    this.homeStatus.textContent = connected
      ? uiText(language, 'connectedModel', { model })
      : uiText(language, 'localEvaluation');
    this.disconnectButton.hidden = !connected;
    this.settingsStatus.textContent = connected
      ? uiText(language, 'connectedModel', { model })
      : uiText(language, 'localEvaluation');
    this.modelInput.value = model;
    this.keyInput.value = '';
    this.keyInput.placeholder = connected
      ? uiText(language, 'savedLocally')
      : uiText(language, 'pasteKey');
  }

  hide(): void {
    this.panel.hidden = true;
    this.keyInput.value = '';
    if (this.options.isMainStarted()) this.options.settingsHome.hidden = false;
  }

  private bindEvents(): void {
    this.openButton.addEventListener('click', () => {
      if (this.panel.hidden) {
        void this.show().catch(() => {
          setPopupStatus(
            this.options.status,
            'error',
            popupText(this.options.getLanguage(), 'settingsFailed'),
          );
        });
      } else {
        this.hide();
      }
    });
    this.closeButton.addEventListener('click', () => this.hide());
    this.saveButton.addEventListener('click', () => void this.connect());
    this.disconnectButton.addEventListener(
      'click',
      () => void this.disconnect(),
    );
  }

  private async show(): Promise<void> {
    await this.refresh();
    this.options.settingsHome.hidden = true;
    this.options.savedMaterialsView.hidden = true;
    this.options.readwiseSettingsPanel.hidden = true;
    this.options.privacySettingsPanel.hidden = true;
    this.options.result.hidden = true;
    this.panel.hidden = false;
    this.panel.scrollIntoView({ block: 'start' });
    this.modelInput.focus();
  }

  private async connect(): Promise<void> {
    this.saveButton.disabled = true;
    try {
      const operation = await beginDataOperation();
      await commitDataOperation(operation, async () => {
        this.settings = await saveAiAnalyzerSettings(
          this.keyInput.value,
          this.modelInput.value,
        );
        // Connecting cloud AI is an explicit user action, so it may disable the
        // fail-closed local-only default without changing how the key is stored.
        await saveLocalOnlyMode(false);
      });
      this.renderState();
      this.options.onSettingsChanged();
      setPopupStatus(
        this.options.status,
        'success',
        uiText(this.options.getLanguage(), 'connectedModel', {
          model: this.settings?.model ?? '',
        }),
      );
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      this.settingsStatus.textContent = popupText(
        this.options.getLanguage(),
        'settingsFailed',
      );
    } finally {
      this.saveButton.disabled = false;
    }
  }

  private async disconnect(): Promise<void> {
    this.disconnectButton.disabled = true;
    try {
      const operation = await beginDataOperation();
      await commitDataOperation(operation, () => clearAiAnalyzerSettings());
      this.settings = null;
      this.renderState();
      this.options.onSettingsChanged();
      setPopupStatus(
        this.options.status,
        'success',
        uiText(this.options.getLanguage(), 'localEvaluation'),
      );
    } catch (error) {
      if (error instanceof DataOperationCancelledError) return;
      this.settingsStatus.textContent = popupText(
        this.options.getLanguage(),
        'settingsFailed',
      );
    } finally {
      this.disconnectButton.disabled = false;
    }
  }
}
