import {
  beginDataOperation,
  assertDataOperationCurrent,
  withAttentionDataLock,
} from '../../privacy/data-operations';
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
import {
  loadAiAnalysisDiagnostic,
  aiAnalysisDiagnosticExport,
} from '../../diagnostics/ai-analysis';

interface PrivacyCopy {
  navigationTitle: string;
  navigationDescription: string;
  title: string;
  done: string;
  localTitle: string;
  localDescription: string;
  localOn: string;
  localOff: string;
  aiSummary: string;
  helpTitle: string;
  helpDescription: string;
  gatewayTitle: string;
  gatewayDescription: string;
  accessTitle: string;
  accessDescription: string;
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
  aiReportTitle: string;
  aiReportDescription: string;
  aiReportButton: string;
  aiReportEmpty: string;
  aiReportSaved: string;
}

const ru: PrivacyCopy = {
  aiReportTitle: 'Последняя проверка с ИИ',
  aiReportDescription:
    'Поможет разобраться с результатом проверки статьи. Без текста статьи, профиля и ключей.',
  aiReportButton: 'Скачать отчёт ИИ-анализа',
  aiReportEmpty:
    'Отчёта пока нет. Откройте статью и нажмите «Проверить с AI» в карточке.',
  aiReportSaved: 'Отчёт скачан. Его можно прислать для разбора.',
  navigationTitle: 'Конфиденциальность и данные',
  navigationDescription: 'Отправка данных в ИИ и удаление',
  title: 'Конфиденциальность и данные',
  done: 'Готово',
  localTitle: 'Работать только на устройстве',
  localDescription: 'Не отправлять статьи и данные профиля в ИИ.',
  localOn: 'Включено. Проверка с ИИ отключена.',
  localOff: 'Выключено. Проверка с ИИ — только по вашему запросу.',
  aiSummary:
    'Когда вы запускаете проверку с ИИ, текст статьи и выбранные сведения из профиля передаются сервису анализа.',
  helpTitle: 'Помощь при неполадках',
  helpDescription:
    'Если что-то не работает, сохраните отчёт для поддержки. Ничего не отправляется автоматически.',
  gatewayTitle: 'Какие данные передаются',
  gatewayDescription:
    'По вашему запросу Vercel AI Gateway и выбранная модель получают текст статьи, вашу цель и выбранные сведения из профиля, знаний и истории. При создании профиля с ИИ передаются ваши ответы. Полный профиль и исходные заметки не отправляются. Локальный режим запрещает эти ИИ-запросы; синхронизация подключённых сервисов остаётся доступной по вашему действию.',
  accessTitle: 'Зачем нужен доступ к сайтам',
  accessDescription:
    'Он нужен, чтобы карточки работали на обычных веб-страницах. Attention читает видимый текст локально; само разрешение не означает отправку данных в сеть.',
  profileExportTitle: 'Отчёт для поддержки',
  profileExportDescription:
    'Версия расширения и общая статистика. Без содержимого профиля, статей, заметок, адресов и ключей.',
  exportProfile: 'Скачать отчёт',
  profileExported: 'Отчёт скачан: {filename}',
  profileExportFailed: 'Не удалось создать отчёт.',
  diagnosticsTitle: 'Журнал ошибок',
  diagnosticsDescription:
    'Поможет найти причину сбоя. Без содержимого страниц, профиля, адресов и ключей.',
  diagnosticsEmpty: 'Ошибок пока не зафиксировано.',
  diagnosticsCount: 'Записей в журнале: {count}.',
  copyDiagnostics: 'Копировать журнал',
  copied: 'Журнал скопирован.',
  clearDiagnostics: 'Очистить',
  deleteTitle: 'Удалить мои данные',
  deleteDescription:
    'Удалит данные Attention из этого браузера: профиль, сохранённые материалы, настройки и подключения. Отменить это нельзя.',
  deleteButton: 'Удалить мои данные',
  deleteConfirm:
    'Безвозвратно удалить все данные Attention из этого браузера: профиль, историю, сохранённые материалы, локальные копии подключённых источников, настройки, отчёты и ключи? Оригиналы в подключённых сервисах останутся. Отменить это действие нельзя.',
  deleted: 'Все данные Attention удалены.',
};

const en: PrivacyCopy = {
  aiReportTitle: 'Last AI check',
  aiReportDescription:
    'Helps troubleshoot an article check. No article text, profile or keys.',
  aiReportButton: 'Download AI analysis report',
  aiReportEmpty:
    'No report yet. Open an article and select “Check with AI” on its card.',
  aiReportSaved: 'Report downloaded. You can share it for troubleshooting.',
  navigationTitle: 'Privacy and data',
  navigationDescription: 'AI data sharing and deletion',
  title: 'Privacy and data',
  done: 'Done',
  localTitle: 'Work only on this device',
  localDescription: 'Prevent articles and profile data from being sent to AI.',
  localOn: 'On. Cloud AI checks are off.',
  localOff: 'Off. AI checks run only when you ask.',
  aiSummary:
    'When you request an AI check, the article text and selected details from your profile are shared with the analysis service.',
  helpTitle: 'Help with a problem',
  helpDescription:
    'If something goes wrong, save a report for support. Nothing is sent automatically.',
  gatewayTitle: 'What data is shared',
  gatewayDescription:
    'At your request, Vercel AI Gateway and your selected model receive article text, your goal and selected details from your profile, knowledge and history. AI profile creation sends your answers instead. Your full profile and original notes are not sent. Local-only mode blocks these AI requests; connected services can still sync when you ask.',
  accessTitle: 'Why website access is needed',
  accessDescription:
    'This is required for cards on normal web pages. Attention reads visible text locally; the permission itself does not send data anywhere.',
  profileExportTitle: 'Support report',
  profileExportDescription:
    'Extension version and general usage counts. No profile content, articles, notes, addresses or keys.',
  exportProfile: 'Download report',
  profileExported: 'Report downloaded: {filename}',
  profileExportFailed: 'Could not create the report.',
  diagnosticsTitle: 'Error log',
  diagnosticsDescription:
    'Helps identify what went wrong. No page content, profile, addresses or keys.',
  diagnosticsEmpty: 'No errors recorded.',
  diagnosticsCount: 'Log entries: {count}.',
  copyDiagnostics: 'Copy error log',
  copied: 'Error log copied.',
  clearDiagnostics: 'Clear',
  deleteTitle: 'Delete my data',
  deleteDescription:
    'Removes Attention data from this browser: your profile, saved items, settings and connections. This cannot be undone.',
  deleteButton: 'Delete my data',
  deleteConfirm:
    'Permanently delete all Attention data from this browser: your profile, history, saved items, local copies of connected sources, settings, reports and keys? Originals in connected services will remain. This cannot be undone.',
  deleted: 'All Attention data was deleted.',
};

const overrides: Partial<Record<UiLanguage, Partial<PrivacyCopy>>> = {
  de: {
    navigationTitle: 'Datenschutz und Daten',
    navigationDescription: 'Daten für KI und Daten löschen',
    title: 'Datenschutz und Daten',
    done: 'Fertig',
    localTitle: 'Nur auf diesem Gerät arbeiten',
    localDescription: 'Keine Artikel oder Profildaten an KI senden.',
    localOn: 'An. KI-Prüfungen in der Cloud sind ausgeschaltet.',
    localOff: 'Aus. KI-Prüfungen starten nur auf Ihren Wunsch.',
    aiSummary:
      'Wenn Sie eine KI-Prüfung starten, werden der Artikeltext und ausgewählte Angaben aus Ihrem Profil an den Analysedienst übermittelt.',
    helpTitle: 'Hilfe bei Problemen',
    helpDescription:
      'Wenn etwas nicht funktioniert, speichern Sie einen Bericht für den Support. Nichts wird automatisch gesendet.',
    gatewayTitle: 'Welche Daten werden übermittelt?',
    gatewayDescription:
      'Auf Ihren Wunsch erhalten Vercel AI Gateway und das gewählte Modell den Artikeltext, Ihr Ziel und ausgewählte Angaben aus Profil, Wissen und Verlauf. Bei der KI-Profilerstellung werden stattdessen Ihre Antworten gesendet. Das vollständige Profil und Originalnotizen werden nicht gesendet. Der lokale Modus blockiert diese KI-Anfragen; verbundene Dienste können auf Ihren Wunsch weiterhin synchronisieren.',
    accessTitle: 'Warum ist Zugriff auf Websites nötig?',
    accessDescription:
      'Damit Attention Karten auf Webseiten anzeigen kann. Der sichtbare Text wird lokal gelesen. Die Berechtigung allein sendet keine Daten.',
    profileExportTitle: 'Bericht für den Support',
    profileExportDescription:
      'Version der Erweiterung und allgemeine Nutzungszahlen. Keine Profilinhalte, Artikel, Notizen, Adressen oder Schlüssel.',
    exportProfile: 'Bericht herunterladen',
    profileExported: 'Bericht heruntergeladen: {filename}',
    profileExportFailed: 'Der Bericht konnte nicht erstellt werden.',
    aiReportTitle: 'Letzte KI-Prüfung',
    aiReportDescription:
      'Hilft, Probleme bei einer Artikelprüfung zu verstehen. Ohne Artikeltext, Profil oder Schlüssel.',
    aiReportButton: 'KI-Bericht herunterladen',
    aiReportEmpty:
      'Noch kein Bericht. Öffnen Sie einen Artikel und wählen Sie auf der Karte „Mit KI prüfen“.',
    aiReportSaved:
      'Bericht heruntergeladen. Sie können ihn zur Fehlersuche teilen.',
    diagnosticsTitle: 'Fehlerprotokoll',
    diagnosticsDescription:
      'Hilft, die Fehlerursache zu finden. Ohne Seiteninhalte, Profil, Adressen oder Schlüssel.',
    diagnosticsEmpty: 'Keine Fehler aufgezeichnet.',
    diagnosticsCount: 'Protokolleinträge: {count}.',
    copyDiagnostics: 'Protokoll kopieren',
    copied: 'Protokoll kopiert.',
    clearDiagnostics: 'Leeren',
    deleteTitle: 'Meine Daten löschen',
    deleteDescription:
      'Entfernt Attention-Daten aus diesem Browser: Profil, gespeicherte Artikel, Einstellungen und Verbindungen. Das lässt sich nicht rückgängig machen.',
    deleteButton: 'Meine Daten löschen',
    deleteConfirm:
      'Alle Attention-Daten aus diesem Browser dauerhaft löschen: Profil, Verlauf, gespeicherte Artikel, lokale Kopien verbundener Quellen, Einstellungen, Berichte und Schlüssel? Die Originale in verbundenen Diensten bleiben erhalten. Das lässt sich nicht rückgängig machen.',
    deleted: 'Alle Attention-Daten wurden gelöscht.',
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
    getElement<HTMLButtonElement>('export-ai-analysis').addEventListener(
      'click',
      () => void this.exportAiAnalysis(),
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
      'ai-report-title': copy.aiReportTitle,
      'ai-report-description': copy.aiReportDescription,
      'export-ai-analysis': copy.aiReportButton,
      'privacy-navigation-title': copy.navigationTitle,
      'privacy-navigation-description': copy.navigationDescription,
      'privacy-settings-title': copy.title,
      'close-privacy-settings': copy.done,
      'local-only-title': copy.localTitle,
      'local-only-description': copy.localDescription,
      'privacy-ai-summary': copy.aiSummary,
      'privacy-help-title': copy.helpTitle,
      'privacy-help-description': copy.helpDescription,
      'gateway-disclosure-title': copy.gatewayTitle,
      'gateway-disclosure-description': copy.gatewayDescription,
      'site-access-title': copy.accessTitle,
      'site-access-description': copy.accessDescription,
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
    const [settings, diagnostics] = await Promise.all([
      loadPrivacySettings(),
      loadDiagnostics(),
    ]);
    this.localOnly.checked = settings.localOnly;
    getElement<HTMLElement>('local-only-status').textContent =
      settings.localOnly ? copy.localOn : copy.localOff;
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
    await withAttentionDataLock(() => clearDiagnostics());
    await this.refresh();
  }

  private async exportAiAnalysis(): Promise<void> {
    const copy = copyFor(this.options.getLanguage());
    const status = getElement<HTMLElement>('ai-report-status');
    try {
      const operation = await beginDataOperation();
      const report = await loadAiAnalysisDiagnostic();
      await assertDataOperationCurrent(operation);
      if (!report) {
        status.textContent = copy.aiReportEmpty;
        return;
      }
      const blob = new Blob([aiAnalysisDiagnosticExport(report)], {
        type: 'application/json',
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `attention-ai-analysis-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      status.textContent = copy.aiReportSaved;
    } catch {
      status.textContent = copy.profileExportFailed;
    }
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
