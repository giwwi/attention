import type { CardView } from './card-view';
import type { UiLanguage } from '../i18n/ui';
import { cardText } from '../i18n/card';
import { profileCardText } from '../i18n/profile-card';
import { PROFILE_SETUP_OPEN_TYPE } from '../vault/messages';
import { isTrustedUserInteraction } from './user-interaction';

// This view contains no evaluation, article content or inferred preferences.
export function installProfilePrompt(
  view: CardView,
  language: () => UiLanguage,
  signal: AbortSignal,
) {
  const section = document.createElement('section');
  section.className = 'profile-prompt';
  const title = document.createElement('h2');
  title.id = 'attention-profile-title';
  const intro = document.createElement('p');
  const providers = document.createElement('p');
  providers.className = 'profile-providers';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'profile-create-button';
  const status = document.createElement('p');
  status.className = 'profile-status';
  status.setAttribute('role', 'status');
  section.append(title, intro, providers, button, status);
  view.card.append(section);
  view.host.dataset.attentionProfileRequired = 'true';
  view.host.setAttribute('role', 'dialog');
  let opening = false;
  button.addEventListener(
    'click',
    (event) => {
      if (!isTrustedUserInteraction(event) || opening || signal.aborted) return;
      event.preventDefault();
      opening = true;
      button.disabled = true;
      button.textContent = profileCardText(language(), 'opening');
      status.textContent = '';
      void chrome.runtime
        .sendMessage({ type: PROFILE_SETUP_OPEN_TYPE })
        .then((response: unknown) => {
          if (
            !response ||
            typeof response !== 'object' ||
            (response as { ok?: unknown }).ok !== true
          )
            throw new Error('Setup unavailable');
        })
        .catch(() => {
          if (!signal.aborted)
            status.textContent = profileCardText(language(), 'failed');
        })
        .finally(() => {
          if (signal.aborted) return;
          opening = false;
          button.disabled = false;
          button.textContent = profileCardText(language(), 'create');
        });
    },
    { signal },
  );
  return {
    button,
    render(expanded: boolean): void {
      view.card.className = `card expanded profile-required${expanded ? '' : ' profile-compact'}`;
      view.host.dataset.attentionExpanded = String(expanded);
      view.host.setAttribute(
        'aria-label',
        profileCardText(language(), 'title'),
      );
      view.host.lang = language();
      view.host.dir = language() === 'ar' ? 'rtl' : 'ltr';
      view.closeButton.setAttribute(
        'aria-label',
        cardText(language(), 'close'),
      );
      title.textContent = profileCardText(language(), 'title');
      intro.textContent = profileCardText(
        language(),
        expanded ? 'intro' : 'compact',
      );
      providers.textContent = profileCardText(language(), 'providers');
      providers.hidden = !expanded;
      button.textContent = profileCardText(
        language(),
        opening ? 'opening' : 'create',
      );
    },
  };
}
