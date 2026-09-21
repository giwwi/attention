import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import {
  MODEL_BYTES,
  MODEL_CACHE,
  MODEL_FILES,
  MODEL_ID,
  MODEL_INSTALLED_KEY,
  MODEL_REVISION,
  modelUrl,
} from './model';
import type { SemanticInput, SemanticScores } from './selection';

// Runtime code and WASM ship inside the extension. Inference can only read cached model data.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', self.location.href).href;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  match: async (key: string) => caches.match(key, { cacheName: MODEL_CACHE }),
  put: async () => {
    throw new Error('Model cache is read-only during inference');
  },
};
env.backends.onnx.wasm!.wasmPaths = new URL(
  './semantic-runtime/',
  self.location.href,
).href;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;

let extractor: Promise<FeatureExtractionPipeline> | undefined;
let phase = 'initialization';
const createExtractor = pipeline as (
  task: 'feature-extraction',
  id: string,
  options: {
    revision: string;
    dtype: 'q8';
    device: 'wasm';
    local_files_only: true;
  },
) => Promise<FeatureExtractionPipeline>;
const vectors = new Map<string, number[]>();
const progress = (state: 'downloading' | 'loading' | 'ready', value: number) =>
  self.postMessage({ progress: { state, progress: value } });
async function model(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    progress('loading', 100);
    extractor = createExtractor('feature-extraction', MODEL_ID, {
      revision: MODEL_REVISION,
      dtype: 'q8',
      device: 'wasm',
      local_files_only: true,
    });
  }
  return extractor;
}

async function install(): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  let completed = 0;
  for (const file of MODEL_FILES) {
    phase = `download:${file.path}`;
    const response = await fetch(modelUrl(file.path), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error('Download unavailable');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > file.bytes) {
        await reader.cancel();
        throw new Error('Unexpected model size');
      }
      parts.push(value);
      progress(
        'downloading',
        Math.round(((completed + received) / MODEL_BYTES) * 100),
      );
    }
    if (received !== file.bytes) throw new Error('Incomplete model');
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    phase = `verify:${file.path}`;
    if (digest !== file.sha256) throw new Error('Model integrity check failed');
    await cache.put(modelUrl(file.path), new Response(bytes));
    completed += received;
  }
  phase = 'load-model';
  await model();
  // Installation is complete only after the pinned model actually loads.
  await cache.put(MODEL_INSTALLED_KEY, new Response(MODEL_REVISION));
  progress('ready', 100);
}

async function embed(text: string): Promise<number[]> {
  const cached = vectors.get(text);
  if (cached) return cached;
  const output = await (
    await model()
  )(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data, Number);
  if (vector.length !== 384 || vector.some((x) => !Number.isFinite(x)))
    throw new Error('Invalid embedding');
  if (vectors.size >= 700) vectors.delete(vectors.keys().next().value!);
  vectors.set(text, vector);
  return vector;
}
function dot(a: number[], b: number[]): number {
  return a.reduce((sum, x, i) => sum + x * b[i]!, 0);
}
async function rank(input: SemanticInput): Promise<SemanticScores> {
  const queries: number[][] = [];
  for (const query of input.queries)
    queries.push(await embed(`query: ${query.text}`));
  const exclusions: number[][] = [];
  for (const query of input.exclusions)
    exclusions.push(await embed(`query: ${query}`));
  const positive: number[][] = [],
    negative: number[][] = [];
  for (const chunk of input.chunks) {
    const vector = await embed(`passage: ${chunk.text}`);
    positive.push(queries.map((query) => dot(vector, query)));
    negative.push(exclusions.map((query) => dot(vector, query)));
  }
  progress('ready', 100);
  return { positive, negative };
}

// Jobs are serialized by the broker; no article/profile text is persisted or logged.
self.onmessage = async (
  event: MessageEvent<{
    id: string;
    action: 'install' | 'rank';
    input?: SemanticInput;
  }>,
) => {
  const { id, action, input } = event.data;
  try {
    const result = action === 'install' ? await install() : await rank(input!);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    extractor = undefined;
    vectors.clear();
    self.postMessage({
      id,
      ok: false,
      failure: `${phase}:${error instanceof Error ? error.name : 'Error'}`,
    });
  }
};
