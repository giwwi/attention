import {
  UI_LANGUAGE_KEY,
  normalizeUiLanguage,
  type UiLanguage,
} from '../i18n/ui';
import {
  NOTION_CONFIG_TYPE,
  NOTION_CONNECT_TYPE,
  NOTION_DISCONNECT_TYPE,
  NOTION_SYNC_TYPE,
  type NotionResponse,
} from './messages';
import { loadNotionSettings } from './storage';
import type { NotionSettings, NotionSourceMode } from './types';

interface PageCopy {
  eyebrow: string;
  intro: string;
  privacy: string;
  selection: string;
  sourceLabel: string;
  modeMixed: string;
  modeOwn: string;
  modeSaved: string;
  connect: string;
  change: string;
  refresh: string;
  disconnect: string;
  close: string;
  disconnected: string;
  connected: string;
  neverSynced: string;
  summary: string;
  opening: string;
  syncing: string;
  success: string;
  failed: string;
  notConfigured: string;
  disconnectConfirm: string;
}

const ru: PageCopy = {
  eyebrow: 'Выбранный источник знаний',
  intro:
    'Подключите только нужные страницы. Attention использует их локально, чтобы осторожнее оценивать, что для вас уже знакомо.',
  privacy:
    'Текст и локальный индекс Notion не отправляются AI. Подключение имеет только право чтения.',
  selection:
    'Во время подключения Notion сам покажет выбор страниц. Attention не видит остальное рабочее пространство.',
  sourceLabel: 'Что находится на выбранных страницах?',
  modeMixed: 'Смешанный набор',
  modeOwn: 'Мои собственные заметки',
  modeSaved: 'Сохранённые материалы',
  connect: 'Подключить Notion',
  change: 'Изменить доступ к страницам',
  refresh: 'Обновить индекс',
  disconnect: 'Отключить и удалить индекс',
  close: 'Готово',
  disconnected: 'Notion не подключён.',
  connected: 'Подключено пространство «{name}».',
  neverSynced: 'Локальный индекс ещё не создан.',
  summary: '{pages} страниц · {fragments} фрагментов · обновлено {date}',
  opening: 'Открываем безопасное подключение Notion…',
  syncing: 'Читаем выбранные страницы и создаём локальный индекс…',
  success: 'Готово: {pages} страниц и {fragments} фрагментов.',
  failed: 'Не удалось подключить или обновить Notion. Попробуйте ещё раз.',
  notConfigured:
    'OAuth Notion не настроен в этой сборке. Нужен адрес серверного OAuth-маршрута.',
  disconnectConfirm: 'Отключить Notion и удалить локальный индекс Attention?',
};

const en: PageCopy = {
  eyebrow: 'Selected knowledge source',
  intro:
    'Connect only the pages you choose. Attention uses them locally to estimate more carefully what may already be familiar.',
  privacy:
    'Notion text and the local index are never sent to AI. The connection is read-only.',
  selection:
    'Notion shows its own page picker during authorization. Attention cannot see the rest of the workspace.',
  sourceLabel: 'What is in the selected pages?',
  modeMixed: 'A mixture',
  modeOwn: 'My own notes',
  modeSaved: 'Saved materials',
  connect: 'Connect Notion',
  change: 'Change page access',
  refresh: 'Refresh index',
  disconnect: 'Disconnect and delete index',
  close: 'Done',
  disconnected: 'Notion is not connected.',
  connected: 'Workspace “{name}” is connected.',
  neverSynced: 'No local index has been created yet.',
  summary: '{pages} pages · {fragments} fragments · updated {date}',
  opening: 'Opening secure Notion authorization…',
  syncing: 'Reading selected pages and building the local index…',
  success: 'Done: {pages} pages and {fragments} fragments.',
  failed: 'Could not connect or refresh Notion. Please try again.',
  notConfigured:
    'Notion OAuth is not configured in this build. An OAuth broker URL is required.',
  disconnectConfirm: 'Disconnect Notion and delete Attention’s local index?',
};

const overrides: Partial<Record<UiLanguage, Partial<PageCopy>>> = {
  de: {
    eyebrow: 'Ausgewählte Wissensquelle',
    intro:
      'Verbinden Sie nur ausgewählte Seiten. Attention nutzt sie lokal, um Bekanntes vorsichtiger einzuschätzen.',
    privacy:
      'Notion-Text und lokaler Index werden nie an AI gesendet. Der Zugriff ist schreibgeschützt.',
    selection:
      'Notion zeigt beim Verbinden die Seitenauswahl. Der restliche Workspace bleibt unsichtbar.',
    sourceLabel: 'Was enthalten die ausgewählten Seiten?',
    modeMixed: 'Gemischter Bestand',
    modeOwn: 'Meine eigenen Notizen',
    modeSaved: 'Gespeicherte Materialien',
    connect: 'Notion verbinden',
    change: 'Seitenzugriff ändern',
    refresh: 'Index aktualisieren',
    disconnect: 'Trennen und Index löschen',
    close: 'Fertig',
    disconnected: 'Notion ist nicht verbunden.',
  },
  es: {
    eyebrow: 'Fuente de conocimiento seleccionada',
    intro:
      'Conecta solo las páginas que elijas. Attention las usa localmente para estimar mejor lo que ya conoces.',
    privacy:
      'El texto y el índice de Notion nunca se envían a la IA. El acceso es de solo lectura.',
    selection:
      'Notion muestra su selector de páginas al conectar. El resto del espacio no es visible.',
    sourceLabel: '¿Qué contienen las páginas elegidas?',
    modeMixed: 'Una mezcla',
    modeOwn: 'Mis propias notas',
    modeSaved: 'Materiales guardados',
    connect: 'Conectar Notion',
    change: 'Cambiar acceso a páginas',
    refresh: 'Actualizar índice',
    disconnect: 'Desconectar y borrar índice',
    close: 'Listo',
    disconnected: 'Notion no está conectado.',
  },
  fr: {
    eyebrow: 'Source de connaissances choisie',
    intro:
      'Connectez uniquement les pages choisies. Attention les utilise localement pour mieux estimer ce qui vous est familier.',
    privacy:
      'Le texte et l’index Notion ne sont jamais envoyés à l’IA. L’accès est en lecture seule.',
    selection:
      'Notion affiche son sélecteur de pages lors de la connexion. Le reste de l’espace reste invisible.',
    sourceLabel: 'Que contiennent les pages choisies ?',
    modeMixed: 'Un mélange',
    modeOwn: 'Mes propres notes',
    modeSaved: 'Documents enregistrés',
    connect: 'Connecter Notion',
    change: 'Modifier l’accès aux pages',
    refresh: 'Actualiser l’index',
    disconnect: 'Déconnecter et supprimer l’index',
    close: 'Terminé',
    disconnected: 'Notion n’est pas connecté.',
  },
  it: {
    eyebrow: 'Fonte di conoscenza selezionata',
    intro:
      'Collega solo le pagine che scegli. Attention le usa localmente per stimare meglio ciò che conosci già.',
    privacy:
      'Testo e indice Notion non vengono mai inviati all’AI. L’accesso è in sola lettura.',
    selection:
      'Notion mostra il selettore delle pagine durante il collegamento. Il resto dello spazio non è visibile.',
    sourceLabel: 'Cosa contengono le pagine scelte?',
    modeMixed: 'Un insieme misto',
    modeOwn: 'Le mie note',
    modeSaved: 'Materiali salvati',
    connect: 'Collega Notion',
    change: 'Modifica accesso alle pagine',
    refresh: 'Aggiorna indice',
    disconnect: 'Scollega ed elimina indice',
    close: 'Fatto',
    disconnected: 'Notion non è collegato.',
  },
  zh: {
    eyebrow: '已选知识来源',
    intro:
      '只连接您选择的页面。Attention 会在本地使用它们来谨慎估算您已熟悉的内容。',
    privacy: 'Notion 文本和本地索引绝不会发送给 AI。连接仅有读取权限。',
    selection:
      '连接时 Notion 会显示页面选择器。Attention 无法查看工作区的其他内容。',
    sourceLabel: '所选页面包含什么？',
    modeMixed: '混合内容',
    modeOwn: '我自己的笔记',
    modeSaved: '保存的资料',
    connect: '连接 Notion',
    change: '更改页面权限',
    refresh: '更新索引',
    disconnect: '断开并删除索引',
    close: '完成',
    disconnected: 'Notion 未连接。',
  },
  ar: {
    eyebrow: 'مصدر معرفة محدد',
    intro:
      'اربط الصفحات التي تختارها فقط. يستخدمها Attention محلياً لتقدير ما قد يكون مألوفاً لك بحذر.',
    privacy:
      'لا يُرسل نص Notion أو الفهرس المحلي إلى الذكاء الاصطناعي. الاتصال للقراءة فقط.',
    selection:
      'يعرض Notion اختيار الصفحات أثناء الربط. لا يستطيع Attention رؤية بقية مساحة العمل.',
    sourceLabel: 'ماذا تحتوي الصفحات المحددة؟',
    modeMixed: 'مجموعة مختلطة',
    modeOwn: 'ملاحظاتي الخاصة',
    modeSaved: 'مواد محفوظة',
    connect: 'ربط Notion',
    change: 'تغيير الوصول إلى الصفحات',
    refresh: 'تحديث الفهرس',
    disconnect: 'قطع الاتصال وحذف الفهرس',
    close: 'تم',
    disconnected: 'Notion غير متصل.',
  },
  hi: {
    eyebrow: 'चुना हुआ ज्ञान स्रोत',
    intro:
      'केवल चुने हुए पेज कनेक्ट करें। Attention उन्हें लोकल रूप से उपयोग करके परिचित जानकारी का सावधानी से अनुमान लगाता है।',
    privacy:
      'Notion का टेक्स्ट और लोकल इंडेक्स AI को कभी नहीं भेजे जाते। कनेक्शन केवल पढ़ने के लिए है।',
    selection:
      'कनेक्ट करते समय Notion पेज चुनने देता है। Attention बाकी workspace नहीं देख सकता।',
    sourceLabel: 'चुने हुए पेजों में क्या है?',
    modeMixed: 'मिश्रित संग्रह',
    modeOwn: 'मेरे अपने नोट्स',
    modeSaved: 'सहेजी गई सामग्री',
    connect: 'Notion कनेक्ट करें',
    change: 'पेज एक्सेस बदलें',
    refresh: 'इंडेक्स अपडेट करें',
    disconnect: 'डिस्कनेक्ट करके इंडेक्स हटाएँ',
    close: 'पूर्ण',
    disconnected: 'Notion कनेक्ट नहीं है।',
  },
};

function copyFor(language: UiLanguage): PageCopy {
  if (language === 'ru') return ru;
  return { ...en, ...overrides[language] };
}

function element<T extends HTMLElement>(id: string): T {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing #${id}`);
  return item as T;
}

const status = element<HTMLElement>('notion-status');
const summary = element<HTMLElement>('notion-summary');
const sourceMode = element<HTMLSelectElement>('notion-source-mode');
const connectButton = element<HTMLButtonElement>('connect-notion');
const syncButton = element<HTMLButtonElement>('sync-notion');
const disconnectButton = element<HTMLButtonElement>('disconnect-notion');
let copy = en;

function setBusy(busy: boolean): void {
  connectButton.disabled = busy;
  syncButton.disabled = busy;
  disconnectButton.disabled = busy;
  sourceMode.disabled = busy;
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

function selectedMode(): NotionSourceMode {
  const value = sourceMode.value;
  return value === 'own-notes' || value === 'saved-materials' ? value : 'mixed';
}

function render(settings: NotionSettings): void {
  status.textContent = settings.connected
    ? copy.connected.replace('{name}', settings.workspaceName ?? 'Notion')
    : copy.disconnected;
  summary.textContent = settings.lastSyncedAt
    ? copy.summary
        .replace('{pages}', String(settings.pageCount))
        .replace('{fragments}', String(settings.fragmentCount))
        .replace('{date}', formattedDate(settings.lastSyncedAt))
    : copy.neverSynced;
  sourceMode.value = settings.sourceMode;
  connectButton.textContent = settings.connected ? copy.change : copy.connect;
  syncButton.hidden = !settings.connected;
  disconnectButton.hidden = !settings.connected;
}

function translate(): void {
  const values: Record<string, string> = {
    'notion-eyebrow': copy.eyebrow,
    'notion-intro': copy.intro,
    'notion-privacy': copy.privacy,
    'notion-selection': copy.selection,
    'notion-source-label': copy.sourceLabel,
    'notion-mode-mixed': copy.modeMixed,
    'notion-mode-own': copy.modeOwn,
    'notion-mode-saved': copy.modeSaved,
    'close-notion': copy.close,
    'sync-notion': copy.refresh,
    'disconnect-notion': copy.disconnect,
  };
  for (const [id, value] of Object.entries(values)) {
    element<HTMLElement>(id).textContent = value;
  }
}

async function request(message: unknown): Promise<NotionResponse> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  return response && typeof response === 'object'
    ? (response as NotionResponse)
    : { ok: false, error: 'invalid_response' };
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function connect(): Promise<void> {
  setBusy(true);
  status.textContent = copy.opening;
  try {
    const config = await request({ type: NOTION_CONFIG_TYPE });
    if (!config.ok || !config.clientId) {
      status.textContent =
        config.error === 'oauth_not_configured'
          ? copy.notConfigured
          : copy.failed;
      return;
    }
    const redirectUri = chrome.identity.getRedirectURL('notion');
    const state = randomState();
    const authorization = new URL('https://api.notion.com/v1/oauth/authorize');
    authorization.searchParams.set('owner', 'user');
    authorization.searchParams.set('client_id', config.clientId);
    authorization.searchParams.set('redirect_uri', redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('state', state);
    const returnedUrl = await chrome.identity.launchWebAuthFlow({
      url: authorization.toString(),
      interactive: true,
    });
    if (!returnedUrl) return;
    const callback = new URL(returnedUrl);
    if (callback.searchParams.get('state') !== state) {
      throw new Error('oauth_state_mismatch');
    }
    const code = callback.searchParams.get('code');
    if (!code) throw new Error(callback.searchParams.get('error') ?? 'oauth');
    status.textContent = copy.syncing;
    const response = await request({
      type: NOTION_CONNECT_TYPE,
      code,
      redirectUri,
      sourceMode: selectedMode(),
    });
    if (!response.ok) throw new Error(response.error ?? 'connect_failed');
    const settings = await loadNotionSettings();
    render(settings);
    status.textContent = copy.success
      .replace('{pages}', String(settings.pageCount))
      .replace('{fragments}', String(settings.fragmentCount));
  } catch (error) {
    if (
      error instanceof Error &&
      /cancel|closed|canceled|user rejected/iu.test(error.message)
    ) {
      render(await loadNotionSettings());
      return;
    }
    console.warn('[attention:notion] connection failed', error);
    status.textContent = copy.failed;
  } finally {
    setBusy(false);
  }
}

async function sync(): Promise<void> {
  setBusy(true);
  status.textContent = copy.syncing;
  try {
    const response = await request({
      type: NOTION_SYNC_TYPE,
      sourceMode: selectedMode(),
    });
    if (!response.ok) throw new Error(response.error ?? 'sync_failed');
    const settings = await loadNotionSettings();
    render(settings);
    status.textContent = copy.success
      .replace('{pages}', String(settings.pageCount))
      .replace('{fragments}', String(settings.fragmentCount));
  } catch (error) {
    console.warn('[attention:notion] sync failed', error);
    status.textContent = copy.failed;
  } finally {
    setBusy(false);
  }
}

async function disconnect(): Promise<void> {
  if (!window.confirm(copy.disconnectConfirm)) return;
  setBusy(true);
  try {
    const response = await request({ type: NOTION_DISCONNECT_TYPE });
    if (!response.ok) throw new Error(response.error ?? 'disconnect_failed');
    render(await loadNotionSettings());
  } catch (error) {
    console.warn('[attention:notion] disconnect failed', error);
    status.textContent = copy.failed;
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
  copy = copyFor(language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  translate();
  render(await loadNotionSettings());
  connectButton.addEventListener('click', () => void connect());
  syncButton.addEventListener('click', () => void sync());
  disconnectButton.addEventListener('click', () => void disconnect());
  element<HTMLButtonElement>('close-notion').addEventListener(
    'click',
    () => void closePage(),
  );
}

void initialize().catch((error) => {
  console.warn('[attention:notion] initialization failed', error);
  status.textContent = copy.failed;
});
