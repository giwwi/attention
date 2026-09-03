import { createServer } from 'node:http';

const port = 4317;
const paragraph =
  'This article explains a concrete method for allocating attention. It presents evidence, a causal mechanism, practical steps, limitations, and examples that make the argument testable and useful.';
const articleBody = Array.from(
  { length: 24 },
  (_, index) => `<p>${index + 1}. ${paragraph}</p>`,
).join('');

function shell(title, body, script = '') {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta property="og:title" content="${title}">
      <title>${title}</title>
      <style>
        body { font: 18px/1.55 system-ui, sans-serif; margin: 0; color: #17201b; }
        main { max-width: 760px; margin: 60px auto; padding: 0 24px; }
        article { margin: 40px 0; }
        h1 { font-size: 44px; line-height: 1.1; }
        h2 { font-size: 28px; }
        a { color: #075e45; }
      </style>
    </head>
    <body><main id="main">${body}</main>${script}</body>
  </html>`;
}

function article(title) {
  return `<article itemprop="articleBody">
    <h1 itemprop="headline">${title}</h1>
    <p class="dek">A practical, evidence-aware guide to better attention decisions.</p>
    <h2>Why this matters</h2>
    ${articleBody}
    <p>Further reading: <a id="body-link" href="/article/related">related material</a>.</p>
  </article>`;
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (path === '/feed') {
    response.end(
      shell(
        'Attention fixture feed',
        `<h1>Fixture feed</h1>
         <article><a id="feed-link" href="/article/one"><h2>A rigorous guide to allocating attention</h2></a><p>${paragraph}</p></article>`,
      ),
    );
    return;
  }
  if (path === '/spa') {
    response.end(
      shell(
        'SPA fixture feed',
        `<h1>SPA feed</h1><a id="spa-link" href="/article/spa"><h2>Open the hydrated SPA article</h2></a>`,
        `<script>
          window.fixtureRouteTransitions = 0;
          document.addEventListener('click', (event) => {
            const link = event.target.closest('#spa-link');
            if (!link) return;
            event.preventDefault();
            history.pushState({}, '', '/article/spa');
            window.fixtureRouteTransitions += 1;
            document.title = 'Hydrated SPA article';
            document.querySelector('meta[property="og:title"]').content = 'Hydrated SPA article';
            setTimeout(() => {
              document.querySelector('#main').innerHTML = ${JSON.stringify(article('Hydrated SPA article'))};
            }, 80);
          });
        </script>`,
      ),
    );
    return;
  }
  if (path.startsWith('/article/')) {
    const title =
      path === '/article/related'
        ? 'Related material'
        : 'A rigorous guide to allocating attention';
    response.end(shell(title, article(title)));
    return;
  }
  response.statusCode = 404;
  response.end('Not found');
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
