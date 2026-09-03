import type { UiLanguage } from '../../i18n/ui';
import { invalidateMaterialEvaluations } from '../../memory/material-memory';
import {
  READWISE_CONNECT_TYPE,
  READWISE_SYNC_TYPE,
  type ReadwiseSyncResponse,
} from '../../readwise/messages';
import {
  clearReadwiseConnection,
  loadReadwiseSettings,
} from '../../readwise/storage';
import { getElement, setPopupStatus } from '../dom';
import { LATEST_EVALUATION_KEY } from '../storage-keys';

interface ReadwiseCopy {
  navigationDescription: string;
  eyebrow: string;
  title: string;
  done: string;
  intro: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  connect: string;
  sync: string;
  disconnect: string;
  privacy: string;
  tokenLink: string;
  disconnected: string;
  connected: string;
  neverSynced: string;
  summary: string;
  syncing: string;
  connectedSuccess: string;
  syncedSuccess: string;
  disconnectedSuccess: string;
  disconnectConfirm: string;
}

const ru: ReadwiseCopy = {
  navigationDescription: 'Выделения и заметки для оценки новизны',
  eyebrow: 'Локальные свидетельства знакомства',
  title: 'Readwise',
  done: 'Готово',
  intro:
    'Attention использует ваши выделения и заметки, чтобы осторожнее оценивать, что для вас действительно ново.',
  tokenLabel: 'Readwise access token',
  tokenPlaceholder: 'Вставьте access token',
  connect: 'Подключить и синхронизировать',
  sync: 'Синхронизировать сейчас',
  disconnect: 'Удалить данные Readwise',
  privacy:
    'Токен, выделения и заметки хранятся локально в Chrome. Attention не отправляет содержимое Readwise в AI. Только выбранный вами фрагмент отправляется в Readwise после явного нажатия «Сохранить в Readwise».',
  tokenLink: 'Где получить access token →',
  disconnected: 'Не подключён',
  connected: 'Подключён · {count} выделений',
  neverSynced: 'Синхронизация ещё не выполнялась.',
  summary: '{sources} источников · {highlights} выделений · {notes} заметок',
  syncing: 'Получаем выделения из Readwise…',
  connectedSuccess: 'Readwise подключён. Следующие оценки учтут выделения.',
  syncedSuccess: 'Данные Readwise обновлены.',
  disconnectedSuccess: 'Токен и локальные данные Readwise удалены.',
  disconnectConfirm: 'Удалить токен и все локальные сигналы Readwise?',
};

const en: ReadwiseCopy = {
  navigationDescription: 'Highlights and notes for novelty estimates',
  eyebrow: 'Local familiarity evidence',
  title: 'Readwise',
  done: 'Done',
  intro:
    'Attention uses your highlights and notes to estimate more carefully what may actually be new to you.',
  tokenLabel: 'Readwise access token',
  tokenPlaceholder: 'Paste access token',
  connect: 'Connect and sync',
  sync: 'Sync now',
  disconnect: 'Delete Readwise data',
  privacy:
    'Your token, highlights and notes stay in Chrome local storage. Attention never sends Readwise content to AI. Only a passage you select is sent to Readwise after you explicitly choose “Save to Readwise”.',
  tokenLink: 'Get an access token →',
  disconnected: 'Not connected',
  connected: 'Connected · {count} highlights',
  neverSynced: 'No sync has been completed yet.',
  summary: '{sources} sources · {highlights} highlights · {notes} notes',
  syncing: 'Fetching highlights from Readwise…',
  connectedSuccess: 'Readwise connected. New evaluations will use highlights.',
  syncedSuccess: 'Readwise data updated.',
  disconnectedSuccess: 'Readwise token and local data deleted.',
  disconnectConfirm: 'Delete the token and all local Readwise signals?',
};

const overrides: Partial<Record<UiLanguage, Partial<ReadwiseCopy>>> = {
  de: {
    navigationDescription: 'Markierungen und Notizen für Neuheitsschätzungen',
    eyebrow: 'Lokale Vertrautheitssignale',
    done: 'Fertig',
    connect: 'Verbinden und synchronisieren',
    sync: 'Jetzt synchronisieren',
    disconnect: 'Readwise-Daten löschen',
    disconnected: 'Nicht verbunden',
  },
  es: {
    navigationDescription: 'Subrayados y notas para estimar la novedad',
    eyebrow: 'Evidencia local de familiaridad',
    done: 'Listo',
    connect: 'Conectar y sincronizar',
    sync: 'Sincronizar ahora',
    disconnect: 'Eliminar datos de Readwise',
    disconnected: 'No conectado',
  },
  fr: {
    navigationDescription: 'Surlignages et notes pour estimer la nouveauté',
    eyebrow: 'Indices locaux de familiarité',
    done: 'Terminé',
    connect: 'Connecter et synchroniser',
    sync: 'Synchroniser',
    disconnect: 'Supprimer les données Readwise',
    disconnected: 'Non connecté',
  },
  it: {
    navigationDescription: 'Evidenziazioni e note per stimare la novità',
    eyebrow: 'Evidenza locale di familiarità',
    done: 'Fatto',
    connect: 'Collega e sincronizza',
    sync: 'Sincronizza ora',
    disconnect: 'Elimina dati Readwise',
    disconnected: 'Non collegato',
  },
  zh: {
    navigationDescription: '用高亮和笔记估算新颖度',
    eyebrow: '本地熟悉度证据',
    done: '完成',
    connect: '连接并同步',
    sync: '立即同步',
    disconnect: '删除 Readwise 数据',
    disconnected: '未连接',
  },
  ar: {
    navigationDescription: 'التظليلات والملاحظات لتقدير الجِدّة',
    eyebrow: 'دلائل محلية على المعرفة السابقة',
    done: 'تم',
    connect: 'اتصال ومزامنة',
    sync: 'مزامنة الآن',
    disconnect: 'حذف بيانات Readwise',
    disconnected: 'غير متصل',
  },
  hi: {
    navigationDescription: 'नवीनता अनुमान के लिए हाइलाइट और नोट्स',
    eyebrow: 'लोकल परिचितता संकेत',
    done: 'पूर्ण',
    connect: 'कनेक्ट और सिंक करें',
    sync: 'अभी सिंक करें',
    disconnect: 'Readwise डेटा हटाएँ',
    disconnected: 'कनेक्ट नहीं है',
  },
};

function copyFor(language: UiLanguage): ReadwiseCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

function isResponse(value: unknown): value is ReadwiseSyncResponse {
  return Boolean(value && typeof value === 'object' && 'ok' in value);
}

export interface ReadwiseControllerOptions {
  status: HTMLParagraphElement;
  profileRoot: HTMLElement;
  savedMaterialsView: HTMLElement;
  aiSettingsPanel: HTMLElement;
  privacySettingsPanel: HTMLElement;
  result: HTMLElement;
  getLanguage: () => UiLanguage;
  onEvidenceChanged: () => void;
}

export class ReadwiseController {
  private readonly openButton = getElement<HTMLButtonElement>(
    'open-readwise-settings',
  );
  private readonly sourceStatus = getElement<HTMLElement>(
    'readwise-home-status',
  );
  private readonly panel = getElement<HTMLElement>('readwise-settings');
  private readonly tokenInput = getElement<HTMLInputElement>('readwise-token');
  private readonly connectButton =
    getElement<HTMLButtonElement>('connect-readwise');
  private readonly syncButton = getElement<HTMLButtonElement>('sync-readwise');
  private readonly disconnectButton = getElement<HTMLButtonElement>(
    'disconnect-readwise',
  );
  private readonly statusLine = getElement<HTMLElement>(
    'readwise-settings-status',
  );
  private readonly summary = getElement<HTMLElement>('readwise-summary');

  constructor(private readonly options: ReadwiseControllerOptions) {
    this.openButton.addEventListener('click', () => void this.show());
    getElement<HTMLButtonElement>('close-readwise-settings').addEventListener(
      'click',
      () => this.hide(),
    );
    this.connectButton.addEventListener('click', () => void this.connect());
    this.syncButton.addEventListener('click', () => void this.sync());
    this.disconnectButton.addEventListener(
      'click',
      () => void this.disconnect(),
    );
  }

  get isVisible(): boolean {
    return !this.panel.hidden;
  }

  translate(): void {
    const copy = copyFor(this.options.getLanguage());
    const text: Record<string, string> = {
      'readwise-navigation-description': copy.navigationDescription,
      'readwise-eyebrow': copy.eyebrow,
      'readwise-settings-title': copy.title,
      'close-readwise-settings': copy.done,
      'readwise-intro': copy.intro,
      'readwise-token-label': copy.tokenLabel,
      'connect-readwise': copy.connect,
      'sync-readwise': copy.sync,
      'disconnect-readwise': copy.disconnect,
      'readwise-privacy-note': copy.privacy,
      'readwise-token-link': copy.tokenLink,
    };
    for (const [id, value] of Object.entries(text)) {
      getElement<HTMLElement>(id).textContent = value;
    }
    this.tokenInput.placeholder = copy.tokenPlaceholder;
  }

  async refresh(): Promise<void> {
    this.translate();
    const settings = await loadReadwiseSettings();
    const copy = copyFor(this.options.getLanguage());
    this.sourceStatus.textContent = settings.connected
      ? copy.connected.replace('{count}', String(settings.highlightCount))
      : copy.disconnected;
    this.statusLine.textContent = settings.connected
      ? copy.connected.replace('{count}', String(settings.highlightCount))
      : copy.disconnected;
    this.summary.textContent = settings.lastSyncedAt
      ? copy.summary
          .replace('{sources}', String(settings.sourceCount))
          .replace('{highlights}', String(settings.highlightCount))
          .replace('{notes}', String(settings.noteCount))
      : copy.neverSynced;
    this.connectButton.hidden = settings.connected;
    this.syncButton.hidden = !settings.connected;
    this.disconnectButton.hidden = !settings.connected;
    this.tokenInput
      .closest('label')
      ?.toggleAttribute('hidden', settings.connected);
    this.tokenInput.value = '';
  }

  hide(): void {
    this.panel.hidden = true;
    this.openButton.setAttribute('aria-expanded', 'false');
    this.options.profileRoot.hidden = false;
  }

  private async show(): Promise<void> {
    await this.refresh();
    this.options.profileRoot.hidden = true;
    this.options.savedMaterialsView.hidden = true;
    this.options.aiSettingsPanel.hidden = true;
    this.options.privacySettingsPanel.hidden = true;
    this.options.result.hidden = true;
    this.panel.hidden = false;
    this.openButton.setAttribute('aria-expanded', 'true');
    this.panel.scrollIntoView({ block: 'start' });
    if (!this.connectButton.hidden) this.tokenInput.focus();
  }

  private errorMessage(code?: string): string {
    if (code === 'invalid_token') return 'Readwise отклонил access token.';
    if (code === 'rate_limited') {
      return 'Readwise временно ограничил синхронизацию. Попробуйте позже.';
    }
    if (code === 'not_connected') return 'Сначала подключите Readwise.';
    return 'Не удалось синхронизировать Readwise.';
  }

  private setBusy(busy: boolean): void {
    this.connectButton.disabled = busy;
    this.syncButton.disabled = busy;
    this.disconnectButton.disabled = busy;
  }

  private async request(message: unknown): Promise<ReadwiseSyncResponse> {
    const response: unknown = await chrome.runtime.sendMessage(message);
    return isResponse(response)
      ? response
      : { ok: false, error: 'invalid_response' };
  }

  private async connect(): Promise<void> {
    const token = this.tokenInput.value.trim();
    if (!token) {
      this.statusLine.textContent = 'Вставьте Readwise access token.';
      return;
    }
    const copy = copyFor(this.options.getLanguage());
    this.setBusy(true);
    this.statusLine.textContent = copy.syncing;
    try {
      const response = await this.request({
        type: READWISE_CONNECT_TYPE,
        token,
      });
      if (!response.ok) throw new Error(this.errorMessage(response.error));
      await this.refresh();
      this.options.onEvidenceChanged();
      setPopupStatus(this.options.status, 'success', copy.connectedSuccess);
    } catch (error) {
      this.statusLine.textContent =
        error instanceof Error ? error.message : this.errorMessage();
    } finally {
      this.setBusy(false);
    }
  }

  private async sync(): Promise<void> {
    const copy = copyFor(this.options.getLanguage());
    this.setBusy(true);
    this.statusLine.textContent = copy.syncing;
    try {
      const response = await this.request({ type: READWISE_SYNC_TYPE });
      if (!response.ok) throw new Error(this.errorMessage(response.error));
      await this.refresh();
      this.options.onEvidenceChanged();
      setPopupStatus(this.options.status, 'success', copy.syncedSuccess);
    } catch (error) {
      this.statusLine.textContent =
        error instanceof Error ? error.message : this.errorMessage();
    } finally {
      this.setBusy(false);
    }
  }

  private async disconnect(): Promise<void> {
    const copy = copyFor(this.options.getLanguage());
    if (!window.confirm(copy.disconnectConfirm)) return;
    this.setBusy(true);
    try {
      await Promise.all([
        clearReadwiseConnection(),
        chrome.storage.local.remove(LATEST_EVALUATION_KEY),
        invalidateMaterialEvaluations(),
      ]);
      await this.refresh();
      this.options.onEvidenceChanged();
      setPopupStatus(this.options.status, 'success', copy.disconnectedSuccess);
    } finally {
      this.setBusy(false);
    }
  }
}
