import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateReadingTime,
  captureDocument,
  countWords,
} from '../src/content/capture';

describe('captureDocument', () => {
  beforeEach(() => {
    document.documentElement.lang = '';
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.title = '';
  });

  it('extracts the main article and its metadata', () => {
    document.documentElement.lang = 'ru';
    document.head.innerHTML = `
      <title>Проверяем ценность чтения</title>
      <meta property="og:site_name" content="Исследовательский журнал" />
      <meta name="author" content="Анна Петрова" />
      <meta property="article:published_time" content="2026-08-20T09:00:00Z" />
      <meta name="description" content="Как принимать решение о чтении материала." />
    `;
    document.body.innerHTML = `
      <nav>Главная Каталог Подписка Контакты</nav>
      <main>
        <article>
          <h1>Проверяем ценность чтения</h1>
          <p>${'Полезный содержательный абзац о внимании пользователя. '.repeat(20)}</p>
          <h2>Почему это важно</h2>
          <p>${'Новый материал должен добавлять знания, а не повторять известное. '.repeat(20)} <a href="https://doi.org/10.1000/attention">Исследование</a></p>
          <blockquote>Качественная статья показывает основания для вывода.</blockquote>
          <h2>Практический вывод</h2>
          <p>${'Сначала оцениваем пользу, затем принимаем решение о чтении. '.repeat(20)}</p>
        </article>
        <aside>Реклама и популярные материалы</aside>
      </main>
      <footer>Политика конфиденциальности</footer>
    `;

    const capture = captureDocument(
      document,
      'https://example.com/articles/attention',
      new Date('2026-08-25T10:00:00Z'),
    );

    expect(capture.title).toBe('Проверяем ценность чтения');
    expect(capture.siteName).toBe('Исследовательский журнал');
    expect(capture.byline).toBe('Анна Петрова');
    expect(capture.publishedTime).toBe('2026-08-20T09:00:00Z');
    expect(capture.language).toBe('ru');
    expect(capture.content).toContain('Полезный содержательный абзац');
    expect(capture.content).not.toContain('Реклама');
    expect(capture.content).not.toContain('Политика конфиденциальности');
    expect(capture.headings).toContain('Почему это важно');
    expect(capture.wordCount).toBeGreaterThan(300);
    expect(capture.readingTimeMinutes).toBeGreaterThanOrEqual(2);
    expect(capture.isArticle).toBe(true);
    expect(capture.extractionMethod).toBe('readability');
    expect(capture.structure?.paragraphCount).toBeGreaterThanOrEqual(3);
    expect(capture.structure?.headingCount).toBeGreaterThanOrEqual(3);
    expect(capture.structure?.citationLinkCount).toBe(1);
    expect(capture.structure?.quoteCount).toBe(1);
    expect(capture.capturedAt).toBe('2026-08-25T10:00:00.000Z');
  });

  it('falls back to a semantic main block on a short page', () => {
    document.title = 'Короткая заметка';
    document.body.innerHTML = `
      <nav>Меню сайта</nav>
      <main><h1>Короткая заметка</h1><p>Короткий, но полезный текст.</p></main>
      <footer>Подвал сайта</footer>
    `;

    const capture = captureDocument(document, 'https://notes.example/short');

    expect(capture.content).toBe(
      'Короткая заметка Короткий, но полезный текст.',
    );
    expect(capture.content).not.toContain('Меню сайта');
    expect(capture.extractionMethod).toBe('semantic');
    expect(capture.siteName).toBe('notes.example');
  });

  it('captures the foreground SPA article instead of the feed left behind it', () => {
    const title = 'What makes slop, slop?';
    document.title = `${title} - by ampdot and Lyn - ampdot's blog`;
    document.body.innerHTML = `
      <main class="reader-nav-page">
        <article data-background-feed>
          <h1><a href="https://publication.example/p/slop">${title}</a></h1>
          <p>${'Background feed preview that must not be analyzed. '.repeat(12)}</p>
        </article>
      </main>
      <article class="newsletter-post post-viewer-post" data-current-article>
        <header><h1><a href="https://publication.example/p/slop">${title}</a></h1></header>
        <div class="available-content reader2-post-content">
          ${'<p>The foreground article contains its own detailed argument and evidence.</p>'.repeat(35)}
        </div>
      </article>
    `;

    const capture = captureDocument(
      document,
      'https://substack.com/home/post/p-199967519',
    );

    expect(capture.title).toBe(title);
    expect(capture.content).toContain(
      'The foreground article contains its own detailed argument',
    );
    expect(capture.content).not.toContain('Background feed preview');
    expect(capture.wordCount).toBeGreaterThan(250);
    expect(capture.isArticle).toBe(true);
  });
});

describe('reading metrics', () => {
  it('counts Unicode words and rounds reading time up', () => {
    expect(countWords('Один, два, three и 2026-й.')).toBe(5);
    expect(calculateReadingTime(0)).toBe(0);
    expect(calculateReadingTime(221)).toBe(2);
  });
});
