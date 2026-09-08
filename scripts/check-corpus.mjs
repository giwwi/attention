import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(path.join(tmpdir(), 'attention-corpus-'));
try {
  const bundle = path.join(temp, 'evaluate.mjs');
  await build({
    entryPoints: ['src/pilot/corpus.ts'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { evaluateChallengeCorpus } = await import(pathToFileURL(bundle).href);
  const corpus = JSON.parse(
    await readFile('experiments/corpus/seed-v1.json', 'utf8'),
  );
  const report = evaluateChallengeCorpus(corpus);
  await mkdir('output/stage-3-4', { recursive: true });
  await writeFile(
    'output/stage-3-4/corpus-report.json',
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `Synthetic development challenge: false known ${report.novelty.falseKnown}; missed equivalences ${report.novelty.missedSame}; quality ordering ${report.quality.correctlyOrdered}/${report.quality.pairs}. This is not a user study.\n`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
