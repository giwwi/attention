import { describe, expect, it } from 'vitest';
import {
  findFeedbackReadingEndTarget,
  findFeedbackReadingRoot,
} from '../src/content/feedback-reading';

describe('feedback-only reading surface', () => {
  it('selects a headingless open Substack article instead of feed cards', () => {
    const title =
      'Thinking about other industries like we think about data centers shows how impoverished the debate is';
    document.title = title;
    document.body.innerHTML = `
      <main class="reader-nav-page">
        <div role="article">${'A feed-card comment. '.repeat(30)}</div>
        <div role="article">${'Another feed-card preview. '.repeat(35)}</div>
      </main>
      <article class="newsletter-post post-viewer-post">
        <div><a href="https://publication.example/p/post">${title}</a></div>
        <div class="available-content reader2-post-content">
          <div class="body markup">
            <p>${'The substantive open article and its evidence. '.repeat(80)}</p>
          </div>
        </div>
      </article>
    `;

    expect(findFeedbackReadingRoot(document, title)).toBe(
      document.querySelector('article.newsletter-post'),
    );
  });

  it('chooses the foreground modal when the feed contains a duplicate title', () => {
    const title = 'What makes slop, slop?';
    document.title = `${title} - by ampdot and Lyn - ampdot's blog`;
    document.body.innerHTML = `
      <main>
        <article data-background-feed>
          <h1><a href="https://publication.example/p/slop">${title}</a></h1>
          <p>${'A duplicate preview still mounted in the feed. '.repeat(14)}</p>
        </article>
      </main>
      <article class="newsletter-post post-viewer-post" data-current-article>
        <h1><a href="https://publication.example/p/slop">${title}</a></h1>
        ${'<p>The foreground reading surface contains the complete material.</p>'.repeat(40)}
      </article>
    `;

    expect(findFeedbackReadingRoot(document, title)).toBe(
      document.querySelector('[data-current-article]'),
    );
  });

  it('uses the conclusion rather than subscription UI or detached footnotes', () => {
    document.body.innerHTML = `
      <article>
        <div class="body markup">
          <p data-conclusion>${'The actual conclusion of the article. '.repeat(5)}</p>
          <div class="subscription-widget"><p>${'Thanks for reading. Subscribe below. '.repeat(3)}</p></div>
          <div class="footnote"><p>${'A detached footnote outside reading order. '.repeat(3)}</p></div>
        </div>
      </article>
    `;
    const root = document.querySelector<HTMLElement>('article');

    expect(findFeedbackReadingEndTarget(root)).toBe(
      document.querySelector('[data-conclusion]'),
    );
  });

  it('stops at the LessWrong post body instead of including comments', () => {
    const title = 'A LessWrong article with a long discussion';
    document.title = `${title} — LessWrong`;
    document.body.innerHTML = `
      <main>
        <h1>${title}</h1>
        <section id="postBody">
          <div class="PostsPage-postContent instapaper_body">
            <div id="postContent">
              <p>${'The article develops its argument and evidence. '.repeat(20)}</p>
              <p data-conclusion>${'This is the actual conclusion of the post. '.repeat(5)}</p>
            </div>
          </div>
        </section>
        <section class="PostsPage-commentsSection">
          <h2>Comments</h2>
          <p data-comment>${'A long comment should not extend reading progress. '.repeat(40)}</p>
        </section>
      </main>
    `;

    const root = findFeedbackReadingRoot(document, title);
    expect(root).toBe(document.querySelector('#postContent'));
    expect(findFeedbackReadingEndTarget(root)).toBe(
      document.querySelector('[data-conclusion]'),
    );
    expect(root?.contains(document.querySelector('[data-comment]'))).toBe(
      false,
    );
  });

  it('ignores a comments section when a generic article root contains it', () => {
    document.body.innerHTML = `
      <article>
        <p data-conclusion>${'The article conclusion contains enough substance. '.repeat(5)}</p>
        <section class="comments-section">
          <p data-comment>${'A reader comment appears after the article. '.repeat(10)}</p>
        </section>
      </article>
    `;
    const root = document.querySelector<HTMLElement>('article');

    expect(findFeedbackReadingEndTarget(root)).toBe(
      document.querySelector('[data-conclusion]'),
    );
  });
});
