import { SEMANTIC_CONTROL, type SemanticStatus } from './model';
import type { UiLanguage } from '../i18n/ui';

const copy = {
  en: {
    title: 'Find passages by meaning',
    description:
      'Experimental, on your device. Matches passages to your goals even when the words differ. Found matches can help you decide where to start reading.',
    download: 'Download and enable · 135 MB',
    enable: 'Enable',
    disable: 'Turn off',
    remove: 'Remove model',
    privacy:
      'A one-time download from Hugging Face. Your profile and articles stay on this device. No API key needed.',
    off: 'Off',
    ready: 'On · works offline',
    downloading: 'Downloading',
    loading: 'Preparing model…',
    error:
      'Could not start. Check your connection and free space, then try again.',
    cancel: 'Cancel',
  },
  ru: {
    title: 'Искать фрагменты по смыслу',
    description:
      'Экспериментальная функция на вашем устройстве. Находит связь с вашими целями, даже если слова разные. Найденные совпадения помогают выбрать, с чего начать чтение.',
    download: 'Скачать и включить · 135 МБ',
    enable: 'Включить',
    disable: 'Выключить',
    remove: 'Удалить модель',
    privacy:
      'Один раз скачаем модель с Hugging Face. Профиль и статьи остаются на этом устройстве. API-ключ не нужен.',
    off: 'Выключено',
    ready: 'Включено · работает без интернета',
    downloading: 'Загружаем',
    loading: 'Подготавливаем модель…',
    error:
      'Не удалось запустить. Проверьте интернет и свободное место, затем попробуйте ещё раз.',
    cancel: 'Отмена',
  },
  de: {
    title: 'Passagen nach Bedeutung finden',
    description:
      'Experimentell, auf Ihrem Gerät. Findet Bezüge zu Ihren Zielen auch bei anderen Formulierungen. Gefundene Bezüge helfen Ihnen, einen Einstieg ins Lesen zu finden.',
    download: 'Herunterladen und aktivieren · 135 MB',
    enable: 'Aktivieren',
    disable: 'Ausschalten',
    remove: 'Modell entfernen',
    privacy:
      'Einmaliger Download von Hugging Face. Ihr Profil und Ihre Artikel bleiben auf diesem Gerät. Kein API-Schlüssel nötig.',
    off: 'Aus',
    ready: 'Aktiv · funktioniert offline',
    downloading: 'Download',
    loading: 'Modell wird vorbereitet…',
    error:
      'Start fehlgeschlagen. Bitte Verbindung und freien Speicher prüfen und erneut versuchen.',
    cancel: 'Abbrechen',
  },
};
export class SemanticSettings {
  private state: SemanticStatus = {
    state: 'off',
    progress: 0,
    installed: false,
    enabled: false,
  };
  private busy = false;
  private failed = false;
  private poll: ReturnType<typeof setTimeout> | undefined;
  private controlId = 0;
  private pendingControl = false;
  constructor(
    private root: HTMLElement,
    private language: () => UiLanguage,
  ) {
    root.innerHTML =
      '<strong data-semantic="title"></strong><p data-semantic="description"></p><p data-semantic="privacy"></p><p data-semantic="status" role="status" aria-live="polite"></p><progress max="100" hidden aria-label="Download"></progress><div class="settings-inline-actions"><button type="button" data-semantic="toggle"></button><button type="button" class="text-button" data-semantic="remove"></button></div>';
    this.element('toggle').addEventListener('click', () => {
      void this.control(this.busy || this.state.enabled ? 'disable' : 'enable');
    });
    this.element('remove').addEventListener('click', () => {
      void this.control('remove');
    });
    this.render();
    void this.refresh();
  }
  private element(name: string): HTMLElement {
    return this.root.querySelector(`[data-semantic="${name}"]`)!;
  }
  render(): void {
    const language = this.language();
    const text = copy[language === 'ru' || language === 'de' ? language : 'en'];
    for (const key of ['title', 'description', 'privacy'] as const)
      this.element(key).textContent = text[key];
    this.element('status').textContent =
      this.failed || this.state.state === 'error'
        ? text.error
        : this.state.state === 'downloading'
          ? `${text.downloading} · ${this.state.progress}%`
          : this.state.state === 'loading'
            ? text.loading
            : this.state.enabled
              ? text.ready
              : text.off;
    this.element('toggle').textContent = this.busy
      ? text.cancel
      : this.state.enabled
        ? text.disable
        : this.state.installed
          ? text.enable
          : text.download;
    this.element('remove').textContent = text.remove;
    this.element('remove').hidden = this.busy || !this.state.installed;
    const progress = this.root.querySelector('progress')!;
    progress.hidden = !this.busy;
    progress.value = this.state.progress;
  }
  async refresh(): Promise<void> {
    const current = this.controlId;
    try {
      const response = await chrome.runtime.sendMessage({
        type: SEMANTIC_CONTROL,
        action: 'status',
      });
      if (response?.ok && current === this.controlId) {
        this.state = response.status;
        this.busy =
          ['downloading', 'loading'].includes(this.state.state) &&
          !this.state.enabled;
        this.render();
      }
    } catch {
      /* Popup can close or lock while polling. */
    } finally {
      this.scheduleRefresh();
    }
  }
  private scheduleRefresh(): void {
    clearTimeout(this.poll);
    if (this.busy || this.pendingControl)
      this.poll = setTimeout(() => void this.refresh(), 1000);
  }
  private async control(action: string): Promise<void> {
    const current = ++this.controlId;
    this.pendingControl = true;
    this.failed = false;
    this.busy = action === 'enable';
    this.render();
    this.scheduleRefresh();
    try {
      const response = await chrome.runtime.sendMessage({
        type: SEMANTIC_CONTROL,
        action,
      });
      if (current !== this.controlId) return;
      if (!response?.ok) this.failed = true;
      else this.state = response.status;
    } catch {
      if (current === this.controlId) this.failed = true;
    } finally {
      if (current === this.controlId) {
        this.pendingControl = false;
        this.busy = false;
        this.scheduleRefresh();
        this.render();
      }
    }
  }
}
