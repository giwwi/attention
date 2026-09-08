import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const licenseName = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i;
const noticeName = /^(?:notice|copyright)(?:[._-].*)?$/i;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const licensesDirectory = fileURLToPath(
  new URL('./licenses/', import.meta.url),
);
const missingPackageLicenses = {
  '@ai-sdk/provider-utils@5.0.36': {
    filename: 'ai-provider-utils-5.0.36-LICENSE.txt',
    license: 'Apache-2.0',
    source:
      'https://github.com/vercel/ai/blob/8a09c78c039e2c092468eaeff97faaabf3b77366/LICENSE',
  },
};

async function collectNoticeFiles(directory, relativeDirectory = '') {
  const entries = await readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const result = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
      result.push(...(await collectNoticeFiles(directory, relativePath)));
    } else if (
      entry.isFile() &&
      (licenseName.test(entry.name) || noticeName.test(entry.name))
    ) {
      result.push(relativePath);
    }
  }
  return result.sort(compareText);
}

async function findPackage(inputPath, rootDir) {
  if (!inputPath.split(/[\\/]/).includes('node_modules')) return null;
  // Use real paths so pnpm's symlinked package directories resolve correctly.
  const resolvedInput = await realpath(path.resolve(rootDir, inputPath));
  if (!resolvedInput.split(path.sep).includes('node_modules')) return null;
  let directory = path.dirname(resolvedInput);
  while (directory !== path.dirname(directory)) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(directory, 'package.json'), 'utf8'),
      );
      // Some packages have type-only package.json files in dist subdirectories.
      if (manifest.name && manifest.version) return { directory, manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not identify bundled dependency: ${inputPath}`);
}

/**
 * Write complete third-party license/notice texts for packages contributing
 * bytes to esbuild outputs. Pass the actual production build metafiles.
 */
export async function writeThirdPartyNotices({
  metafiles,
  rootDir = process.cwd(),
  outputPath = 'public/THIRD_PARTY_NOTICES.txt',
}) {
  if (!Array.isArray(metafiles) || metafiles.length === 0) {
    throw new Error('At least one esbuild metafile is required.');
  }
  const inputPaths = new Set();
  for (const metafile of metafiles) {
    if (!metafile?.outputs) throw new Error('Invalid esbuild metafile.');
    for (const output of Object.values(metafile.outputs)) {
      for (const [inputPath, input] of Object.entries(output.inputs || {})) {
        if (input.bytesInOutput > 0) inputPaths.add(inputPath);
      }
    }
  }

  const packages = new Map();
  for (const inputPath of [...inputPaths].sort(compareText)) {
    const bundledPackage = await findPackage(inputPath, rootDir);
    if (bundledPackage) {
      packages.set(bundledPackage.directory, bundledPackage);
    }
  }
  const sections = [
    'Attention — Third-party notices',
    'Generated from the packages included in the production extension bundles.',
    'Original license and notice texts are reproduced below.',
  ];
  const included = [];
  let includesApacheLicense = false;
  const sortedPackages = [...packages.values()].sort((left, right) =>
    compareText(
      `${left.manifest.name}@${left.manifest.version}`,
      `${right.manifest.name}@${right.manifest.version}`,
    ),
  );

  for (const { directory, manifest } of sortedPackages) {
    const identifier = `${manifest.name}@${manifest.version}`;
    const noticeFiles = await collectNoticeFiles(directory);
    const hasRootLicense = noticeFiles.some(
      (filename) =>
        path.dirname(filename) === '.' && licenseName.test(filename),
    );
    const fallback = missingPackageLicenses[identifier];
    if (
      !hasRootLicense &&
      (!fallback || fallback.license !== manifest.license)
    ) {
      throw new Error(
        `No license file found for bundled package ${manifest.name}@${manifest.version}.`,
      );
    }
    includesApacheLicense ||= manifest.license === 'Apache-2.0';
    included.push(identifier);
    sections.push(
      '\n' + '='.repeat(78),
      identifier,
      `License: ${typeof manifest.license === 'string' ? manifest.license : 'See original text below'}`,
      '='.repeat(78),
    );
    if (!hasRootLicense) {
      sections.push(
        '\n--- LICENSE (omitted from npm package; verified release source) ---',
        `Source: ${fallback.source}\n`,
        await readFile(path.join(licensesDirectory, fallback.filename), 'utf8'),
      );
    }
    for (const filename of noticeFiles) {
      sections.push(
        `\n--- ${filename} ---\n`,
        await readFile(path.join(directory, filename), 'utf8'),
      );
    }
  }
  if (includesApacheLicense) {
    // Several Apache packages ship only a copyright notice and a license URL.
    // Preserve those notices above and supply the complete license once here.
    sections.push(
      '\n' + '='.repeat(78),
      'Apache License, Version 2.0 — complete license text',
      'Source: https://www.apache.org/licenses/LICENSE-2.0.txt',
      '='.repeat(78),
      await readFile(path.join(licensesDirectory, 'Apache-2.0.txt'), 'utf8'),
    );
  }

  const destination = path.resolve(rootDir, outputPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${sections.join('\n')}\n`);
  return { outputPath: destination, packages: included };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const inputFiles = process.argv.slice(2);
  if (inputFiles.length === 0) {
    throw new Error(
      'Usage: node scripts/third-party-notices.mjs <esbuild-metafile.json> [...]',
    );
  }
  const metafiles = await Promise.all(
    inputFiles.map(async (filename) =>
      JSON.parse(await readFile(filename, 'utf8')),
    ),
  );
  const result = await writeThirdPartyNotices({ metafiles });
  console.log(
    `Collected licenses for ${result.packages.length} bundled packages.`,
  );
}
