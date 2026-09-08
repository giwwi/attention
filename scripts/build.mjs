import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { writeThirdPartyNotices } from './third-party-notices.mjs';

const notionOAuthBrokerUrl = process.env.NOTION_OAUTH_BROKER_URL?.trim() ?? '';
const define = {
  __ATTENTION_NOTION_OAUTH_BROKER_URL__: JSON.stringify(notionOAuthBrokerUrl),
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

if (notionOAuthBrokerUrl) {
  const brokerOrigin = new URL(notionOAuthBrokerUrl).origin;
  const manifestPath = 'dist/manifest.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.permissions.push('identity');
  const policy = manifest.content_security_policy.extension_pages;
  manifest.content_security_policy.extension_pages = policy.replace(
    '; object-src',
    ` ${brokerOrigin}; object-src`,
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const buildResults = await Promise.all([
  build({
    entryPoints: ['src/pilot/page.ts'],
    outfile: 'dist/pilot.js',
    bundle: true,
    format: 'esm',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
  build({
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
    bundle: true,
    format: 'esm',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
  build({
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    bundle: true,
    format: 'iife',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
  build({
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    bundle: true,
    format: 'iife',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
  build({
    entryPoints: ['src/obsidian/page.ts'],
    outfile: 'dist/obsidian.js',
    bundle: true,
    format: 'esm',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
  build({
    entryPoints: ['src/notion/page.ts'],
    outfile: 'dist/notion.js',
    bundle: true,
    format: 'esm',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
]);

await writeThirdPartyNotices({
  metafiles: buildResults.map((result) => result.metafile),
});
await cp('public/THIRD_PARTY_NOTICES.txt', 'dist/THIRD_PARTY_NOTICES.txt');
