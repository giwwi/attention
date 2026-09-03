import {
  UI_LANGUAGE_KEY,
  normalizeUiLanguage,
  type UiLanguage,
} from '../i18n/ui';
import { invalidateMaterialEvaluations } from '../memory/material-memory';
import { LATEST_EVALUATION_KEY } from '../popup/storage-keys';
import {
  clearObsidianDatabase,
  loadVaultHandle,
  saveVaultHandle,
  type PersistedDirectoryHandle,
} from './database';
import { indexObsidianVault } from './indexer';
import { clearObsidianSettings, loadObsidianSettings } from './storage';
import type { ObsidianSettings } from './types';

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read';
  startIn?: string;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions,
  ) => Promise<PersistedDirectoryHandle>;
}

interface PageCopy {
  eyebrow: string;
  title: string;
  intro: string;
  privacy: string;
  filters: string;
  choose: string;
  change: string;
  refresh: string;
  disconnect: string;
  close: string;
  disconnected: string;
  connected: string;
  neverIndexed: string;
  summary: string;
  selecting: string;
  scanning: string;
  reading: string;
  saving: string;
  success: string;
  permissionNeeded: string;
  unsupported: string;
  failed: string;
  disconnectConfirm: string;
}

const ru: PageCopy = {
  eyebrow: 'Локальный источник знаний',
  title: 'Obsidian',
  intro:
    'Подключите один локальный Vault. Attention использует ваши собственные формулировки, чтобы осторожнее оценивать, что для вас уже знакомо.',
  privacy:
    'Заметки и локальный индекс не отправляются AI. Доступ только на чтение; Attention не изменяет файлы Vault.',
  filters:
    'Индексируются только Markdown-файлы. Скрытые папки, .obsidian, изображения, PDF и другие вложения игнорируются.',
  choose: 'Выбрать Vault',
  change: 'Выбрать другой Vault',
  refresh: 'Обновить индекс',
  disconnect: 'Отключить и удалить индекс',
  close: 'Готово',
  disconnected: 'Vault не подключён.',
  connected: 'Подключён Vault «{name}».',
  neverIndexed: 'Индекс ещё не создан.',
  summary: '{notes} заметок · {fragments} фрагментов · обновлено {date}',
  selecting: 'Откройте папку вашего Obsidian Vault…',
  scanning: 'Ищем Markdown-файлы…',
  reading: 'Обрабатываем заметки: {current} из {total}…',
  saving: 'Сохраняем локальный индекс…',
  success: 'Готово: {notes} заметок и {fragments} фрагментов.',
  permissionNeeded:
    'Chrome просит снова подтвердить доступ к ранее выбранной папке.',
  unsupported:
    'Этот Chrome не поддерживает выбор локальной папки через File System Access API.',
  failed: 'Не удалось обработать Vault. Проверьте доступ и попробуйте снова.',
  disconnectConfirm: 'Отключить Obsidian и удалить локальный индекс Attention?',
};

const en: PageCopy = {
  eyebrow: 'Local knowledge source',
  title: 'Obsidian',
  intro:
    'Connect one local Vault. Attention uses your own wording to estimate more carefully what may already be familiar to you.',
  privacy:
    'Notes and the local index are never sent to AI. Access is read-only; Attention does not change Vault files.',
  filters:
    'Only Markdown files are indexed. Hidden folders, .obsidian, images, PDFs, and other attachments are ignored.',
  choose: 'Choose Vault',
  change: 'Choose another Vault',
  refresh: 'Refresh index',
  disconnect: 'Disconnect and delete index',
  close: 'Done',
  disconnected: 'No Vault connected.',
  connected: 'Vault “{name}” is connected.',
  neverIndexed: 'No local index has been created yet.',
  summary: '{notes} notes · {fragments} fragments · updated {date}',
  selecting: 'Choose your Obsidian Vault folder…',
  scanning: 'Finding Markdown files…',
  reading: 'Processing notes: {current} of {total}…',
  saving: 'Saving the local index…',
  success: 'Done: {notes} notes and {fragments} fragments.',
  permissionNeeded: 'Chrome needs access to the previously selected folder.',
  unsupported:
    'This Chrome version does not support local folder selection through the File System Access API.',
  failed: 'Could not process the Vault. Check access and try again.',
  disconnectConfirm: 'Disconnect Obsidian and delete Attention’s local index?',
};

const overrides: Partial<Record<UiLanguage, Partial<PageCopy>>> = {
  de: {
    eyebrow: 'Lokale Wissensquelle',
    intro:
      'Verbinden Sie einen lokalen Vault. Attention nutzt Ihre eigenen Formulierungen, um Bekanntes vorsichtiger einzuschätzen.',
    privacy:
      'Notizen und lokaler Index werden nie an AI gesendet. Der Zugriff ist schreibgeschützt.',
    filters:
      'Nur Markdown-Dateien werden indexiert. Versteckte Ordner, Bilder, PDFs und Anhänge werden ignoriert.',
    choose: 'Vault auswählen',
    change: 'Anderen Vault auswählen',
    refresh: 'Index aktualisieren',
    disconnect: 'Trennen und Index löschen',
    close: 'Fertig',
    disconnected: 'Kein Vault verbunden.',
  },
  es: {
    eyebrow: 'Fuente de conocimiento local',
    intro:
      'Conecta un Vault local. Attention usa tus propias formulaciones para estimar con más cuidado lo que ya conoces.',
    privacy:
      'Las notas y el índice local nunca se envían a la IA. El acceso es de solo lectura.',
    filters:
      'Solo se indexan archivos Markdown. Se ignoran carpetas ocultas, imágenes, PDF y adjuntos.',
    choose: 'Elegir Vault',
    change: 'Elegir otro Vault',
    refresh: 'Actualizar índice',
    disconnect: 'Desconectar y borrar índice',
    close: 'Listo',
    disconnected: 'No hay ningún Vault conectado.',
  },
  fr: {
    eyebrow: 'Source de connaissances locale',
    intro:
      'Connectez un Vault local. Attention utilise vos propres formulations pour mieux estimer ce qui vous est déjà familier.',
    privacy:
      'Les notes et l’index local ne sont jamais envoyés à l’IA. L’accès est en lecture seule.',
    filters:
      'Seuls les fichiers Markdown sont indexés. Les dossiers cachés, images, PDF et pièces jointes sont ignorés.',
    choose: 'Choisir un Vault',
    change: 'Choisir un autre Vault',
    refresh: 'Actualiser l’index',
    disconnect: 'Déconnecter et supprimer l’index',
    close: 'Terminé',
    disconnected: 'Aucun Vault connecté.',
  },
  it: {
    eyebrow: 'Fonte di conoscenza locale',
    intro:
      'Collega un Vault locale. Attention usa le tue formulazioni per stimare con più cautela ciò che già conosci.',
    privacy:
      'Note e indice locale non vengono mai inviati all’AI. L’accesso è in sola lettura.',
    filters:
      'Vengono indicizzati solo i file Markdown. Cartelle nascoste, immagini, PDF e allegati vengono ignorati.',
    choose: 'Scegli Vault',
    change: 'Scegli un altro Vault',
    refresh: 'Aggiorna indice',
    disconnect: 'Disconnetti ed elimina indice',
    close: 'Fatto',
    disconnected: 'Nessun Vault collegato.',
  },
  zh: {
    eyebrow: '本地知识来源',
    intro:
      '连接一个本地 Vault。Attention 会用您自己的表述，更谨慎地判断哪些内容可能已经熟悉。',
    privacy: '笔记和本地索引绝不会发送给 AI。Attention 仅拥有只读权限。',
    filters: '仅索引 Markdown 文件；隐藏文件夹、图片、PDF 和其他附件会被忽略。',
    choose: '选择 Vault',
    change: '选择其他 Vault',
    refresh: '更新索引',
    disconnect: '断开并删除索引',
    close: '完成',
    disconnected: '尚未连接 Vault。',
  },
  ar: {
    eyebrow: 'مصدر معرفة محلي',
    intro:
      'اربط Vault محلياً. يستخدم Attention صياغاتك لتقدير ما قد يكون مألوفاً لديك بحذر أكبر.',
    privacy:
      'لا تُرسل الملاحظات أو الفهرس المحلي إلى الذكاء الاصطناعي. الوصول للقراءة فقط.',
    filters:
      'تُفهرس ملفات Markdown فقط، وتُستبعد المجلدات المخفية والصور وملفات PDF والمرفقات.',
    choose: 'اختيار Vault',
    change: 'اختيار Vault آخر',
    refresh: 'تحديث الفهرس',
    disconnect: 'فصل وحذف الفهرس',
    close: 'تم',
    disconnected: 'لا يوجد Vault متصل.',
  },
  hi: {
    eyebrow: 'लोकल ज्ञान स्रोत',
    intro:
      'एक लोकल Vault कनेक्ट करें। Attention आपके अपने शब्दों से सावधानीपूर्वक अनुमान लगाता है कि क्या पहले से परिचित हो सकता है।',
    privacy:
      'नोट्स और लोकल इंडेक्स AI को कभी नहीं भेजे जाते। एक्सेस केवल पढ़ने के लिए है।',
    filters:
      'केवल Markdown फ़ाइलें इंडेक्स होती हैं। छिपे फ़ोल्डर, चित्र, PDF और अटैचमेंट अनदेखे किए जाते हैं।',
    choose: 'Vault चुनें',
    change: 'दूसरा Vault चुनें',
    refresh: 'इंडेक्स अपडेट करें',
    disconnect: 'डिस्कनेक्ट कर इंडेक्स हटाएँ',
    close: 'पूर्ण',
    disconnected: 'कोई Vault कनेक्ट नहीं है।',
  },
};

function pageCopyFor(language: UiLanguage): PageCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

function element<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing #${id}`);
  return item as T;
}

const status = element<HTMLParagraphElement>('obsidian-status');
const summary = element<HTMLParagraphElement>('obsidian-summary');
const chooseButton = element<HTMLButtonElement>('choose-vault');
const refreshButton = element<HTMLButtonElement>('refresh-vault');
const disconnectButton = element<HTMLButtonElement>('disconnect-vault');
let copy = en;
let currentHandle: PersistedDirectoryHandle | null = null;

function setBusy(busy: boolean): void {
  chooseButton.disabled = busy;
  refreshButton.disabled = busy;
  disconnectButton.disabled = busy;
  document.body.toggleAttribute('aria-busy', busy);
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function render(settings: ObsidianSettings): void {
  const connected = settings.connected && Boolean(settings.vaultName);
  status.textContent = connected
    ? copy.connected.replace('{name}', settings.vaultName ?? '')
    : copy.disconnected;
  summary.textContent = settings.lastIndexedAt
    ? copy.summary
        .replace('{notes}', String(settings.noteCount))
        .replace('{fragments}', String(settings.fragmentCount))
        .replace('{date}', formattedDate(settings.lastIndexedAt))
    : copy.neverIndexed;
  chooseButton.textContent = connected ? copy.change : copy.choose;
  refreshButton.hidden = !connected;
  disconnectButton.hidden = !connected;
}

function translate(): void {
  const values: Record<string, string> = {
    'obsidian-eyebrow': copy.eyebrow,
    'obsidian-title': copy.title,
    'obsidian-intro': copy.intro,
    'obsidian-privacy': copy.privacy,
    'obsidian-filters': copy.filters,
    'close-obsidian': copy.close,
    'refresh-vault': copy.refresh,
    'disconnect-vault': copy.disconnect,
  };
  for (const [id, value] of Object.entries(values)) {
    element<HTMLElement>(id).textContent = value;
  }
}

async function permission(
  handle: PersistedDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
    return true;
  }
  if (!request) return false;
  status.textContent = copy.permissionNeeded;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

async function index(handle: PersistedDirectoryHandle): Promise<void> {
  setBusy(true);
  try {
    const previousSettings = await loadObsidianSettings();
    const result = await indexObsidianVault(handle, (progress) => {
      status.textContent =
        progress.phase === 'scanning'
          ? copy.scanning
          : progress.phase === 'saving'
            ? copy.saving
            : copy.reading
                .replace('{current}', String(progress.processed))
                .replace('{total}', String(progress.total));
    });
    await saveVaultHandle(handle);
    currentHandle = handle;
    render(result.settings);
    status.textContent = copy.success
      .replace('{notes}', String(result.settings.noteCount))
      .replace('{fragments}', String(result.settings.fragmentCount));
    if (
      result.settings.evidenceUpdatedAt !== previousSettings.evidenceUpdatedAt
    ) {
      await Promise.all([
        chrome.storage.local.remove(LATEST_EVALUATION_KEY),
        invalidateMaterialEvaluations(),
      ]);
    }
  } catch (error) {
    console.warn('[attention:obsidian] indexing failed', error);
    status.textContent = copy.failed;
  } finally {
    setBusy(false);
  }
}

async function chooseVault(): Promise<void> {
  const pickerWindow = window as DirectoryPickerWindow;
  if (!pickerWindow.showDirectoryPicker) {
    status.textContent = copy.unsupported;
    return;
  }
  status.textContent = copy.selecting;
  try {
    const handle = await pickerWindow.showDirectoryPicker({
      id: 'attention-obsidian-vault',
      mode: 'read',
    });
    await index(handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      render(await loadObsidianSettings());
      return;
    }
    console.warn('[attention:obsidian] picker failed', error);
    status.textContent = copy.failed;
  }
}

async function refreshVault(): Promise<void> {
  const handle = currentHandle ?? (await loadVaultHandle());
  if (!handle) {
    await chooseVault();
    return;
  }
  if (!(await permission(handle, true))) return;
  await index(handle);
}

async function disconnect(): Promise<void> {
  if (!window.confirm(copy.disconnectConfirm)) return;
  setBusy(true);
  try {
    await Promise.all([
      clearObsidianDatabase(),
      clearObsidianSettings(),
      chrome.storage.local.remove(LATEST_EVALUATION_KEY),
      invalidateMaterialEvaluations(),
    ]);
    currentHandle = null;
    render(await loadObsidianSettings());
  } finally {
    setBusy(false);
  }
}

async function closePage(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) {
    await chrome.tabs.remove(tab.id);
    return;
  }
  window.close();
}

async function initialize(): Promise<void> {
  const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
  const language = normalizeUiLanguage(stored[UI_LANGUAGE_KEY]);
  copy = pageCopyFor(language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  translate();
  currentHandle = await loadVaultHandle();
  render(await loadObsidianSettings());
  if (currentHandle && !(await permission(currentHandle, false))) {
    status.textContent = copy.permissionNeeded;
  }
  chooseButton.addEventListener('click', () => void chooseVault());
  refreshButton.addEventListener('click', () => void refreshVault());
  disconnectButton.addEventListener('click', () => void disconnect());
  element<HTMLButtonElement>('close-obsidian').addEventListener(
    'click',
    () => void closePage(),
  );
}

void initialize().catch((error) => {
  console.warn('[attention:obsidian] initialization failed', error);
  status.textContent = copy.failed;
});
