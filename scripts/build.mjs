import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { writeThirdPartyNotices } from './third-party-notices.mjs';

const notionOAuthBrokerUrl = process.env.NOTION_OAUTH_BROKER_URL?.trim() ?? '';
const define = {
  __ATTENTION_NOTION_OAUTH_BROKER_URL__: JSON.stringify(notionOAuthBrokerUrl),
};
const banner = {
  js: '/*! Attention original code: PolyForm Shield License 1.0.0. See LICENSE, NOTICE and THIRD_PARTY_NOTICES.txt. Source: https://github.com/giwwi/attention */',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('LICENSE', 'dist/LICENSE');
await cp('NOTICE', 'dist/NOTICE');

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
  ...['worker', 'offscreen'].map((name) =>
    build({
      entryPoints: [`src/semantic/${name}.ts`],
      outfile: `dist/semantic-${name}.js`,
      banner,
      bundle: true,
      format: 'esm',
      target: 'chrome116',
      metafile: true,
      minify: true,
      legalComments: 'none',
      define,
      alias: {
        '@huggingface/transformers': path.resolve(
          'node_modules/@huggingface/transformers/src/transformers.js',
        ),
      },
      plugins: [
        {
          name: 'transformers-browser-only',
          setup(builder) {
            builder.onResolve(
              { filter: /^(?:node:.*|onnxruntime-node|sharp)$/ },
              (args) => ({ path: args.path, namespace: 'browser-empty' }),
            );
            builder.onLoad(
              { filter: /.*/, namespace: 'browser-empty' },
              () => ({ contents: 'export default {};', loader: 'js' }),
            );
          },
        },
      ],
    }),
  ),
  build({
    entryPoints: ['src/pilot/page.ts'],
    outfile: 'dist/pilot.js',
    banner,
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
    banner,
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
    banner,
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
    banner,
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
    banner,
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
    banner,
    bundle: true,
    format: 'esm',
    target: 'chrome116',
    metafile: true,
    minify: true,
    legalComments: 'none',
    define,
  }),
]);

// MV3 permits model data downloads, but every executable runtime file is bundled.
const transformersRequire = createRequire(
  path.join(
    await realpath('node_modules/@huggingface/transformers'),
    'package.json',
  ),
);
const ortDirectory = path.dirname(
  transformersRequire.resolve('onnxruntime-web'),
);
await mkdir('dist/semantic-runtime', { recursive: true });
const runtimeInputs = {};
for (const filename of await readdir(ortDirectory)) {
  if (!/^ort-wasm-simd-threaded(?:\.jsep)?\.(?:mjs|wasm)$/.test(filename))
    continue;
  const source = path.join(ortDirectory, filename);
  await cp(source, `dist/semantic-runtime/${filename}`);
  runtimeInputs[source] = { bytesInOutput: 1 };
}
buildResults.push({
  metafile: { outputs: { runtime: { inputs: runtimeInputs } } },
});

await writeThirdPartyNotices({
  metafiles: buildResults.map((result) => result.metafile),
});
await cp('public/THIRD_PARTY_NOTICES.txt', 'dist/THIRD_PARTY_NOTICES.txt');
