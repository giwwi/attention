import {
  beginDataOperation,
  assertDataOperationCurrent,
} from '../../privacy/data-operations';
import { loadPublicSession } from '../../auth/session';
import {
  clearDiagnostics,
  diagnosticsExport,
  loadDiagnostics,
} from '../../diagnostics/diagnostics';
import type { UiLanguage } from '../../i18n/ui';
import { deleteAllAttentionData } from '../../privacy/data-erasure';
import { loadPrivacySettings, saveLocalOnlyMode } from '../../privacy/settings';
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
  localOn:
    'Включено: облачный AI заблокирован. Подключённые сервисы работают по вашему запросу.',
  localOff: 'Выключено: облачный AI доступен после вашего действия.',
  gatewayTitle: 'Когда используется Gateway',
  gatewayDescription:
    'После вашего запроса, если локальный режим выключен, Vercel AI Gateway и выбранная модель получают текст статьи, цель и выбранные сигналы профиля, знаний и истории. При создании профиля с AI передаются ваши ответы. Полный профиль и исходные заметки не отправляются.',
  accessTitle: 'Доступ ко всем сайтам',
  accessDescription:
    'Он нужен, чтобы карточки работали на обычных веб-страницах. Attention читает видимый текст локально; само разрешение не означает отправку данных в сеть.',
  sessionTitle: 'Публичная сессия',
  sessionActive: 'Активна защищённая краткосрочная сессия.',
  sessionInactive: 'Сессии нет. Общий секрет не встроен в расширение.',
  profileExportTitle: 'Сводка для диагностики',
  profileExportDescription:
    'Только версия расширения и общие счётчики. Без содержания профиля, целей, тем, адресов, текстов и ключей.',
  exportProfile: 'Скачать безопасный JSON',
  profileExported: 'Диагностическая сводка скачана: {filename}',
  profileExportFailed: 'Не удалось создать диагностическую сводку.',
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
  localOn:
    'On: cloud AI is blocked. Connected services still work when you request them.',
  localOff: 'Off: cloud AI is available after your action.',
  gatewayTitle: 'When Gateway is used',
  gatewayDescription:
    'On your request, with local-only mode off, Vercel AI Gateway and your selected model receive article text, your goal and selected profile, knowledge and history signals. AI profile creation sends your answers instead. Your full profile and original notes are not sent.',
  accessTitle: 'Access to all websites',
  accessDescription:
    'This is required for cards on normal web pages. Attention reads visible text locally; the permission itself does not send data anywhere.',
  sessionTitle: 'Public session',
  sessionActive: 'A protected short-lived session is active.',
  sessionInactive: 'No session. No shared secret is embedded in the extension.',
  profileExportTitle: 'Diagnostic summary',
  profileExportDescription:
    'Extension version and aggregate counts only. No profile content, goals, topics, addresses, text or keys.',
  exportProfile: 'Download safe JSON',
  profileExported: 'Diagnostic summary downloaded: {filename}',
  profileExportFailed: 'Could not create the diagnostic summary.',
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
    localOn:
      'Aktiv: Cloud-KI ist blockiert. Verbundene Dienste funktionieren weiterhin auf Ihre Anfrage.',
    localOff: 'Inaktiv: Cloud-KI ist nach Ihrer Aktion verfügbar.',
    gatewayTitle: 'Wann Gateway verwendet wird',
    gatewayDescription:
      'Auf Ihre Anfrage und bei deaktiviertem lokalen Modus erhalten Vercel AI Gateway und das gewählte Modell Artikeltext, Ziel und ausgewählte Profil-, Wissens- und Verlaufssignale. Bei der KI-Profilerstellung werden stattdessen Ihre Antworten gesendet. Das vollständige Profil und Originalnotizen werden nicht gesendet.',
    profileExportTitle: 'Diagnoseübersicht',
    profileExportDescription:
      'Nur Erweiterungsversion und Gesamtzahlen. Keine Profilinhalte, Ziele, Themen, Adressen, Texte oder Schlüssel.',
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
    localOn:
      'Activado: la IA en la nube está bloqueada. Los servicios conectados siguen funcionando cuando los solicitas.',
    localOff: 'Desactivado: la IA en la nube está disponible tras tu acción.',
    gatewayTitle: 'Cuándo se usa Gateway',
    gatewayDescription:
      'A petición tuya y con el modo local desactivado, Vercel AI Gateway y el modelo elegido reciben el texto, tu objetivo y señales seleccionadas del perfil, conocimientos e historial. Al crear un perfil con IA se envían tus respuestas. No se envían el perfil completo ni las notas originales.',
    profileExportTitle: 'Resumen de diagnóstico',
    profileExportDescription:
      'Solo la versión de la extensión y cifras agregadas. Sin contenido del perfil, objetivos, temas, direcciones, textos ni claves.',
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
    localOn:
      'Activé : l’IA dans le cloud est bloquée. Les services connectés restent disponibles sur votre demande.',
    localOff:
      'Désactivé : l’IA dans le cloud est disponible après votre action.',
    gatewayTitle: 'Quand Gateway est utilisé',
    gatewayDescription:
      'Sur votre demande, avec le mode local désactivé, Vercel AI Gateway et le modèle choisi reçoivent le texte, votre objectif et des signaux sélectionnés du profil, des connaissances et de l’historique. La création du profil avec l’IA envoie vos réponses. Le profil complet et les notes originales ne sont pas envoyés.',
    profileExportTitle: 'Résumé de diagnostic',
    profileExportDescription:
      'Uniquement la version de l’extension et des totaux. Aucun contenu du profil, objectif, sujet, adresse, texte ou clé.',
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
    localOn:
      'Attivo: l’AI nel cloud è bloccata. I servizi collegati funzionano ancora su tua richiesta.',
    localOff: 'Disattivo: l’AI nel cloud è disponibile dopo una tua azione.',
    gatewayTitle: 'Quando viene usato Gateway',
    gatewayDescription:
      'Su tua richiesta, con la modalità locale disattivata, Vercel AI Gateway e il modello scelto ricevono il testo, il tuo obiettivo e segnali selezionati di profilo, conoscenze e cronologia. La creazione del profilo con AI invia le tue risposte. Il profilo completo e le note originali non vengono inviati.',
    profileExportTitle: 'Riepilogo diagnostico',
    profileExportDescription:
      'Solo versione dell’estensione e conteggi aggregati. Nessun contenuto del profilo, obiettivo, argomento, indirizzo, testo o chiave.',
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
    localOn: '已开启：云端 AI 已被阻止。已连接的服务仍可按您的请求运行。',
    localOff: '已关闭：您操作后可使用云端 AI。',
    gatewayTitle: '何时使用 Gateway',
    gatewayDescription:
      '关闭本地模式并主动请求后，Vercel AI Gateway 和所选模型会收到文章正文、目标及选定的个人资料、知识和历史记录信号。使用 AI 创建资料时，发送的是您的回答。完整资料和原始笔记不会发送。',
    profileExportTitle: '诊断摘要',
    profileExportDescription:
      '仅包含扩展版本和汇总数量。不包含个人资料内容、目标、主题、地址、文本或密钥。',
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
    localOn:
      'مفعّل: الذكاء الاصطناعي السحابي محظور. تظل الخدمات المتصلة متاحة عند طلبك.',
    localOff: 'معطّل: الذكاء الاصطناعي السحابي متاح بعد إجراء منك.',
    gatewayTitle: 'متى تُستخدم Gateway',
    gatewayDescription:
      'بطلب منك ومع إيقاف الوضع المحلي، تتلقى Vercel AI Gateway والنموذج المختار نص المقال وهدفك وإشارات مختارة من الملف والمعرفة وسجل التصفح. عند إنشاء الملف بالذكاء الاصطناعي تُرسل إجاباتك بدلاً من ذلك. لا يُرسل الملف الكامل أو الملاحظات الأصلية.',
    profileExportTitle: 'ملخص التشخيص',
    profileExportDescription:
      'إصدار الإضافة والأعداد الإجمالية فقط. لا محتوى الملف أو الأهداف أو المواضيع أو العناوين أو النصوص أو المفاتيح.',
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
    localOn:
      'चालू: क्लाउड AI अवरुद्ध है। जुड़ी हुई सेवाएँ आपके अनुरोध पर उपलब्ध रहती हैं।',
    localOff: 'बंद: आपकी कार्रवाई के बाद क्लाउड AI उपलब्ध है।',
    gatewayTitle: 'Gateway का उपयोग कब होता है',
    gatewayDescription:
      'आपके अनुरोध पर, लोकल मोड बंद होने पर, Vercel AI Gateway और चुने गए मॉडल को लेख, आपका लक्ष्य और प्रोफ़ाइल, ज्ञान तथा इतिहास के चुने हुए संकेत मिलते हैं। AI से प्रोफ़ाइल बनाने पर आपके उत्तर भेजे जाते हैं। पूरी प्रोफ़ाइल और मूल नोट्स नहीं भेजे जाते।',
    profileExportTitle: 'डायग्नोस्टिक सारांश',
    profileExportDescription:
      'केवल एक्सटेंशन का संस्करण और कुल संख्याएँ। प्रोफ़ाइल की सामग्री, लक्ष्य, विषय, पते, पाठ या कुंजियाँ शामिल नहीं हैं।',
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
    const operation = await beginDataOperation();
    const entries = await loadDiagnostics();
    await assertDataOperationCurrent(operation);
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
      const operation = await beginDataOperation();
      const snapshot = await createDiagnosticProfileExport();
      await assertDataOperationCurrent(operation);
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
    await deleteAllAttentionData();
    await chrome.permissions
      .remove({ permissions: ['history'] })
      .catch(() => false);
    setPopupStatus(this.options.status, 'success', copy.deleted);
    window.location.reload();
  }
}
