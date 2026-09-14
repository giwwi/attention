import type { PersonalProfile } from '../profile/schema';
import { profileText as p } from '../i18n/profile';
import type { ProfileQuestion } from './profile-basics';

interface Entry {
  value: string;
  note?: string;
  set: (value: string) => void;
  remove: () => void;
}
export function renderProfileBrief(
  root: HTMLElement,
  profile: PersonalProfile,
  changed: () => void,
  add: (question: ProfileQuestion) => void,
): void {
  root.replaceChildren();
  const fit = (input: HTMLTextAreaElement): void => {
    if (!input.offsetWidth) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  };
  const fitAll = (): void => root.querySelectorAll('textarea').forEach(fit);
  const entries = <T>(
    items: T[],
    read: (item: T) => string,
    write: (item: T, value: string) => void,
    note?: (item: T) => string,
  ): Entry[] =>
    items.map((item) => ({
      value: read(item),
      note: note?.(item),
      set: (value) => write(item, value),
      remove: () => {
        const i = items.indexOf(item);
        if (i >= 0) items.splice(i, 1);
      },
    }));
  const groups: Array<{
    title: string;
    question: ProfileQuestion;
    items: Entry[];
  }> = [
    {
      title: 'Сейчас мне важно',
      question: 'goal',
      items: entries(
        profile.goals,
        (i) => i.goal,
        (i, v) => (i.goal = v),
        (i) =>
          i.status === 'paused'
            ? p('На паузе')
            : i.status === 'completed'
              ? p('Завершена')
              : '',
      ),
    },
    {
      title: 'Мне интересно',
      question: 'interests',
      items: [
        ...entries(
          profile.interests,
          (i) => i.topic,
          (i, v) => (i.topic = v),
        ),
        ...entries(
          profile.leisureProfile.preferences,
          (i) => i.category,
          (i, v) => (i.category = v),
          (i) => (i.kind === 'dislike' ? p('Не нравится') : p('Для отдыха')),
        ),
      ],
    },
    {
      title: 'Что я знаю и изучаю',
      question: 'knowledge',
      items: [
        ...entries(
          profile.demonstratedKnowledge,
          (i) => i.statement,
          (i, v) => (i.statement = v),
          (i) => i.topic,
        ),
        ...entries(
          profile.expertise,
          (i) => i.topic,
          (i, v) => (i.topic = v),
          (i) =>
            p(
              {
                beginner: 'Начальный',
                intermediate: 'Средний',
                advanced: 'Продвинутый',
                expert: 'Экспертный',
              }[i.level],
            ),
        ),
        ...entries(
          profile.learningAreas,
          (i) => i.topic,
          (i, v) => (i.topic = v),
          () => p('Что сейчас изучаете'),
        ),
      ],
    },
  ];
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'profile-brief-group';
    const heading = document.createElement('h3');
    heading.textContent = p(group.title);
    section.append(heading);
    const more = document.createElement('details');
    const moreTitle = document.createElement('summary');
    moreTitle.textContent = p('Ещё {count}', {
      count: Math.max(0, group.items.length - 3),
    });
    more.append(moreTitle);
    more.addEventListener('toggle', fitAll);
    group.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'profile-brief-entry';
      const label = document.createElement('label');
      const note = document.createElement('span');
      note.textContent = item.note ?? '';
      note.hidden = !item.note;
      const input = document.createElement('textarea');
      input.value = item.value;
      input.rows = Math.min(4, Math.max(1, Math.ceil(item.value.length / 44)));
      input.maxLength = 1500;
      input.setAttribute('aria-label', `${p(group.title)}: ${index + 1}`);
      input.addEventListener('input', () => {
        item.set(input.value);
        fit(input);
      });
      label.append(note, input);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-brief-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `${p('Удалить')}: ${item.value}`);
      remove.addEventListener('click', () => {
        item.remove();
        changed();
      });
      row.append(label, remove);
      (index < 3 ? section : more).append(row);
    });
    if (group.items.length > 3) section.append(more);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-text-button';
    button.textContent = `+ ${p('Дополнить')}`;
    button.dataset.profileAddBasic = group.question;
    button.addEventListener('click', () => add(group.question));
    section.append(button);
    root.append(section);
  }
  requestAnimationFrame(fitAll);
}
