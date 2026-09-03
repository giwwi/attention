import { loadPublicSession } from '../../auth/session';
import {
  clearDiagnostics,
  diagnosticsExport,
  loadDiagnostics,
} from '../../diagnostics/diagnostics';
import type { UiLanguage } from '../../i18n/ui';
import { deleteAllAttentionData } from '../../privacy/data-erasure';
import { loadPrivacySettings, saveLocalOnlyMode } from '../../privacy/settings';
import { NOTION_DISCONNECT_TYPE } from '../../notion/messages';
import {
  createDiagnosticProfileExport,
  diagnosticProfileFilename,
  downloadDiagnosticProfile,
} from '../../profile/diagnostic-export';
import { getElement, setPopupStatus } from '../dom';

interface PrivacyCopy {
  navigationTitle: string;
  navigationDescription: string;
  eyebrow: string;
  title: string;
  done: string;
  localTitle: string;
  localDescription: string;
  localOn: string;
  localOff: string;
  gatewayTitle: string;
  gatewayDescription: string;
  accessTitle: string;
  accessDescription: string;
  sessionTitle: string;
  sessionActive: string;
  sessionInactive: string;
  profileExportTitle: string;
  profileExportDescription: string;
  exportProfile: string;
  profileExported: string;
  profileExportFailed: string;
  diagnosticsTitle: string;
  diagnosticsDescription: string;
  diagnosticsEmpty: string;
  diagnosticsCount: string;
  copyDiagnostics: string;
  copied: string;
  clearDiagnostics: string;
  deleteTitle: string;
  deleteDescription: string;
  deleteButton: string;
  deleteConfirm: string;
  deleted: string;
}

const ru: PrivacyCopy = {
  navigationTitle: 'Приватность и данные',
  navigationDescription: 'Локальный режим, разрешения и удаление',
  eyebrow: 'Контроль пользователя',
  title: 'Приватность и данные',
  done: 'Готово',
  localTitle: 'Только локально',
  localDescription: 'Жёстко запрещает любые облачные AI-запросы',
  localOn: 'Включено: данные не покидают устройство.',
  localOff: 'Выключено: разрешены облачные запросы после вашего действия.',
  gatewayTitle: 'Когда используется Gateway',
  gatewayDescription:
    'Только после вашего действия и только если локальный режим выключен. Передаются текст текущей страницы, задача и не более нескольких локально выбранных сигналов — никогда не полный профиль.',
  accessTitle: 'Доступ ко всем сайтам',
  accessDescription:
    'Он нужен, чтобы карточки работали на обычных веб-страницах. Attention читает видимый текст локально; само разрешение не означает отправку данных в сеть.',
  sessionTitle: 'Публичная сессия',
  sessionActive: 'Активна защищённая краткосрочная сессия.',
  sessionInactive: 'Сессии нет. Общий секрет не встроен в расширение.',
  profileExportTitle: 'Диагностический профиль',
  profileExportDescription:
    'Скачивает сигналы профиля и агрегированную статистику для анализа. Без ключей, токенов, списка посещённых страниц и текстов заметок.',
  exportProfile: 'Скачать безопасный JSON',
  profileExported: 'Диагностический профиль скачан: {filename}',
  profileExportFailed: 'Не удалось создать диагностический профиль.',
  diagnosticsTitle: 'Диагностика',
  diagnosticsDescription:
    'Только коды сбоев и время. Без URL, текста страниц, профиля, ключей, токенов и исходных сообщений ошибок.',
  diagnosticsEmpty: 'Ошибок пока не зафиксировано.',
  diagnosticsCount: 'Событий в локальном журнале: {count}.',
  copyDiagnostics: 'Копировать диагностику',
  copied: 'Безопасная диагностика скопирована.',
  clearDiagnostics: 'Очистить',
  deleteTitle: 'Удалить все данные Attention',
  deleteDescription:
    'Удалит профиль, историю, локальные индексы Obsidian и Notion, сохранённые материалы, настройки, диагностику, сессию и подключённые ключи из Chrome.',
  deleteButton: 'Удалить всё',
  deleteConfirm:
    'Безвозвратно удалить все локальные данные Attention, включая профиль, историю, настройки и Gateway-ключ?',
  deleted: 'Все данные Attention удалены.',
};

const en: PrivacyCopy = {
  navigationTitle: 'Privacy and data',
  navigationDescription: 'Local mode, permissions and deletion',
  eyebrow: 'Your control',
  title: 'Privacy and data',
  done: 'Done',
  localTitle: 'Local only',
  localDescription: 'Hard-block every cloud AI request',
  localOn: 'On: data stays on this device.',
  localOff: 'Off: cloud requests are allowed after your action.',
  gatewayTitle: 'When Gateway is used',
  gatewayDescription:
    'Only after your action and only when local-only mode is off. Attention sends the current page text, your task and a few locally selected signals—never your full profile.',
  accessTitle: 'Access to all websites',
  accessDescription:
    'This is required for cards on normal web pages. Attention reads visible text locally; the permission itself does not send data anywhere.',
  sessionTitle: 'Public session',
  sessionActive: 'A protected short-lived session is active.',
  sessionInactive: 'No session. No shared secret is embedded in the extension.',
  profileExportTitle: 'Diagnostic profile',
  profileExportDescription:
    'Downloads profile signals and aggregate statistics for analysis. No keys, tokens, visited-page list or note text.',
  exportProfile: 'Download safe JSON',
  profileExported: 'Diagnostic profile downloaded: {filename}',
  profileExportFailed: 'Could not create the diagnostic profile.',
  diagnosticsTitle: 'Diagnostics',
  diagnosticsDescription:
    'Failure codes and timestamps only. No URLs, page text, profile values, keys, tokens or raw error messages.',
  diagnosticsEmpty: 'No errors recorded.',
  diagnosticsCount: 'Events in the local log: {count}.',
  copyDiagnostics: 'Copy diagnostics',
  copied: 'Safe diagnostics copied.',
  clearDiagnostics: 'Clear',
  deleteTitle: 'Delete all Attention data',
  deleteDescription:
    'Deletes your profile, history, local Obsidian and Notion indexes, saved items, settings, diagnostics, session and connected keys from Chrome.',
  deleteButton: 'Delete everything',
  deleteConfirm:
    'Permanently delete all local Attention data, including your profile, history, settings and Gateway key?',
  deleted: 'All Attention data was deleted.',
};

const overrides: Partial<Record<UiLanguage, Partial<PrivacyCopy>>> = {
  de: {
    navigationTitle: 'Datenschutz und Daten',
    navigationDescription: 'Lokaler Modus, Berechtigungen und Löschen',
    title: 'Datenschutz und Daten',
    done: 'Fertig',
    localTitle: 'Nur lokal',
    localDescription: 'Blockiert alle Cloud-AI-Anfragen vollständig',
    localOn: 'Aktiv: Daten bleiben auf diesem Gerät.',
    localOff: 'Inaktiv: Cloud-Anfragen sind nach Ihrer Aktion erlaubt.',
    profileExportTitle: 'Diagnoseprofil',
    exportProfile: 'Sicheres JSON herunterladen',
    deleteButton: 'Alles löschen',
  },
  es: {
    navigationTitle: 'Privacidad y datos',
    navigationDescription: 'Modo local, permisos y eliminación',
    title: 'Privacidad y datos',
    done: 'Listo',
    localTitle: 'Solo local',
    localDescription: 'Bloquea todas las solicitudes de IA en la nube',
    localOn: 'Activado: los datos permanecen en este dispositivo.',
    localOff: 'Desactivado: permite la nube después de tu acción.',
    profileExportTitle: 'Perfil de diagnóstico',
    exportProfile: 'Descargar JSON seguro',
    deleteButton: 'Eliminar todo',
  },
  fr: {
    navigationTitle: 'Confidentialité et données',
    navigationDescription: 'Mode local, autorisations et suppression',
    title: 'Confidentialité et données',
    done: 'Terminé',
    localTitle: 'Local uniquement',
    localDescription: 'Bloque toutes les requêtes IA dans le cloud',
    localOn: 'Activé : les données restent sur cet appareil.',
    localOff: 'Désactivé : le cloud est permis après votre action.',
    profileExportTitle: 'Profil de diagnostic',
    exportProfile: 'Télécharger le JSON sécurisé',
    deleteButton: 'Tout supprimer',
  },
  it: {
    navigationTitle: 'Privacy e dati',
    navigationDescription: 'Modalità locale, permessi ed eliminazione',
    title: 'Privacy e dati',
    done: 'Fatto',
    localTitle: 'Solo locale',
    localDescription: 'Blocca tutte le richieste AI al cloud',
    localOn: 'Attivo: i dati restano su questo dispositivo.',
    localOff: 'Disattivo: il cloud è consentito dopo una tua azione.',
    profileExportTitle: 'Profilo diagnostico',
    exportProfile: 'Scarica JSON sicuro',
    deleteButton: 'Elimina tutto',
  },
  zh: {
    navigationTitle: '隐私与数据',
    navigationDescription: '本地模式、权限与删除',
    title: '隐私与数据',
    done: '完成',
    localTitle: '仅本地',
    localDescription: '彻底阻止所有云端 AI 请求',
    localOn: '已开启：数据不会离开此设备。',
    localOff: '已关闭：您操作后可使用云端请求。',
    profileExportTitle: '诊断资料',
    exportProfile: '下载安全 JSON',
    deleteButton: '删除全部',
  },
  ar: {
    navigationTitle: 'الخصوصية والبيانات',
    navigationDescription: 'الوضع المحلي والأذونات والحذف',
    title: 'الخصوصية والبيانات',
    done: 'تم',
    localTitle: 'محلي فقط',
    localDescription: 'يحظر جميع طلبات الذكاء الاصطناعي السحابية',
    localOn: 'مفعّل: تبقى البيانات على هذا الجهاز.',
    localOff: 'معطّل: يسمح بالسحابة بعد إجراء منك.',
    profileExportTitle: 'ملف التشخيص',
    exportProfile: 'تنزيل JSON آمن',
    deleteButton: 'حذف الكل',
  },
  hi: {
    navigationTitle: 'गोपनीयता और डेटा',
    navigationDescription: 'लोकल मोड, अनुमतियाँ और हटाना',
    title: 'गोपनीयता और डेटा',
    done: 'पूर्ण',
    localTitle: 'केवल लोकल',
    localDescription: 'सभी क्लाउड AI अनुरोधों को रोकता है',
    localOn: 'चालू: डेटा इसी डिवाइस पर रहता है।',
    localOff: 'बंद: आपकी कार्रवाई के बाद क्लाउड की अनुमति है।',
    profileExportTitle: 'डायग्नोस्टिक प्रोफ़ाइल',
    exportProfile: 'सुरक्षित JSON डाउनलोड करें',
    deleteButton: 'सब हटाएँ',
  },
};

function copyFor(language: UiLanguage): PrivacyCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

export interface PrivacyControllerOptions {
  status: HTMLParagraphElement;
  settingsHome: HTMLElement;
  savedMaterialsView: HTMLElement;
  aiSettingsPanel: HTMLElement;
  readwiseSettingsPanel: HTMLElement;
  result: HTMLElement;
  getLanguage: () => UiLanguage;
  isMainStarted: () => boolean;
  onModeChanged: () => void;
}

export class PrivacyController {
  private readonly openButton = getElement<HTMLButtonElement>(
    'open-privacy-settings',
  );
  private readonly panel = getElement<HTMLElement>('privacy-settings');
  private readonly closeButton = getElement<HTMLButtonElement>(
    'close-privacy-settings',
  );
  private readonly localOnly = getElement<HTMLInputElement>('local-only-mode');

  constructor(private readonly options: PrivacyControllerOptions) {
    this.openButton.addEventListener('click', () => void this.show());
    this.closeButton.addEventListener('click', () => this.hide());
    this.localOnly.addEventListener('change', () => void this.changeMode());
    getElement<HTMLButtonElement>('copy-diagnostics').addEventListener(
      'click',
      () => void this.copyDiagnostics(),
    );
    getElement<HTMLButtonElement>('clear-diagnostics').addEventListener(
      'click',
      () => void this.removeDiagnostics(),
    );
    getElement<HTMLButtonElement>('export-diagnostic-profile').addEventListener(
      'click',
      () => void this.exportDiagnosticProfile(),
    );
    getElement<HTMLButtonElement>('delete-all-data').addEventListener(
      'click',
      () => void this.deleteAll(),
    );
  }

  get isVisible(): boolean {
    return !this.panel.hidden;
  }

  translate(): void {
    const copy = copyFor(this.options.getLanguage());
    const text: Record<string, string> = {
      'privacy-navigation-title': copy.navigationTitle,
      'privacy-navigation-description': copy.navigationDescription,
      'privacy-eyebrow': copy.eyebrow,
      'privacy-settings-title': copy.title,
      'close-privacy-settings': copy.done,
      'local-only-title': copy.localTitle,
      'local-only-description': copy.localDescription,
      'gateway-disclosure-title': copy.gatewayTitle,
      'gateway-disclosure-description': copy.gatewayDescription,
      'site-access-title': copy.accessTitle,
      'site-access-description': copy.accessDescription,
      'session-title': copy.sessionTitle,
      'profile-export-title': copy.profileExportTitle,
      'profile-export-description': copy.profileExportDescription,
      'export-diagnostic-profile': copy.exportProfile,
      'diagnostics-title': copy.diagnosticsTitle,
      'diagnostics-description': copy.diagnosticsDescription,
      'copy-diagnostics': copy.copyDiagnostics,
      'clear-diagnostics': copy.clearDiagnostics,
      'delete-all-title': copy.deleteTitle,
      'delete-all-description': copy.deleteDescription,
      'delete-all-data': copy.deleteButton,
    };
    for (const [id, value] of Object.entries(text)) {
      getElement<HTMLElement>(id).textContent = value;
    }
  }

  async refresh(): Promise<void> {
    this.translate();
    const copy = copyFor(this.options.getLanguage());
    const [settings, diagnostics, session] = await Promise.all([
      loadPrivacySettings(),
      loadDiagnostics(),
      loadPublicSession(),
    ]);
    this.localOnly.checked = settings.localOnly;
    getElement<HTMLElement>('local-only-status').textContent =
      settings.localOnly ? copy.localOn : copy.localOff;
    getElement<HTMLElement>('session-status').textContent = session
      ? copy.sessionActive
      : copy.sessionInactive;
    getElement<HTMLElement>('diagnostics-summary').textContent =
      diagnostics.length
        ? copy.diagnosticsCount.replace('{count}', String(diagnostics.length))
        : copy.diagnosticsEmpty;
  }

  hide(): void {
    this.panel.hidden = true;
    this.openButton.setAttribute('aria-expanded', 'false');
    if (this.options.isMainStarted()) this.options.settingsHome.hidden = false;
  }

  private async show(): Promise<void> {
    await this.refresh();
    this.options.settingsHome.hidden = true;
    this.options.savedMaterialsView.hidden = true;
    this.options.aiSettingsPanel.hidden = true;
    this.options.readwiseSettingsPanel.hidden = true;
    this.options.result.hidden = true;
    this.panel.hidden = false;
    this.openButton.setAttribute('aria-expanded', 'true');
    this.panel.scrollIntoView({ block: 'start' });
  }

  private async changeMode(): Promise<void> {
    await saveLocalOnlyMode(this.localOnly.checked);
    this.options.onModeChanged();
    await this.refresh();
    const copy = copyFor(this.options.getLanguage());
    setPopupStatus(
      this.options.status,
      'success',
      this.localOnly.checked ? copy.localOn : copy.localOff,
    );
  }

  private async copyDiagnostics(): Promise<void> {
    const entries = await loadDiagnostics();
    await navigator.clipboard.writeText(diagnosticsExport(entries));
    setPopupStatus(
      this.options.status,
      'success',
      copyFor(this.options.getLanguage()).copied,
    );
  }

  private async removeDiagnostics(): Promise<void> {
    await clearDiagnostics();
    await this.refresh();
  }

  private async exportDiagnosticProfile(): Promise<void> {
    const copy = copyFor(this.options.getLanguage());
    try {
      const snapshot = await createDiagnosticProfileExport();
      const filename = diagnosticProfileFilename();
      downloadDiagnosticProfile(snapshot, filename);
      setPopupStatus(
        this.options.status,
        'success',
        copy.profileExported.replace('{filename}', filename),
      );
    } catch {
      setPopupStatus(this.options.status, 'error', copy.profileExportFailed);
    }
  }

  private async deleteAll(): Promise<void> {
    const copy = copyFor(this.options.getLanguage());
    if (!window.confirm(copy.deleteConfirm)) return;
    await chrome.runtime
      .sendMessage({ type: NOTION_DISCONNECT_TYPE })
      .catch(() => undefined);
    await deleteAllAttentionData();
    await chrome.permissions
      .remove({ permissions: ['history'] })
      .catch(() => false);
    setPopupStatus(this.options.status, 'success', copy.deleted);
    window.location.reload();
  }
}
