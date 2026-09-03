import { EXTENSION_RUNTIME_VERSION } from '../shared/version';
import { STORAGE_RETENTION_LIMITS } from '../storage/limits';

export const DIAGNOSTIC_LOG_KEY = 'diagnosticLog';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type DiagnosticCategory =
  | 'network'
  | 'authentication'
  | 'timeout'
  | 'invalid-response'
  | 'storage'
  | 'runtime'
  | 'privacy'
  | 'unknown';

export interface DiagnosticEntry {
  id: string;
  at: string;
  severity: DiagnosticSeverity;
  subsystem: 'ai' | 'background' | 'content' | 'popup' | 'storage' | 'auth';
  operation: string;
  code: string;
  category: DiagnosticCategory;
  version: string;
}

export interface DiagnosticInput {
  severity?: DiagnosticSeverity;
  subsystem: DiagnosticEntry['subsystem'];
  operation: string;
  code: string;
  error?: unknown;
  category?: DiagnosticCategory;
}

function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.at === 'string' &&
    ['info', 'warning', 'error'].includes(String(entry.severity)) &&
    ['ai', 'background', 'content', 'popup', 'storage', 'auth'].includes(
      String(entry.subsystem),
    ) &&
    typeof entry.operation === 'string' &&
    typeof entry.code === 'string' &&
    typeof entry.category === 'string' &&
    typeof entry.version === 'string'
  );
}

export function classifyDiagnosticError(error: unknown): DiagnosticCategory {
  const candidate = error as
    { name?: unknown; message?: unknown; status?: unknown } | undefined;
  const name = String(candidate?.name ?? '').toLocaleLowerCase();
  const message = String(candidate?.message ?? '').toLocaleLowerCase();
  const status = Number(candidate?.status);
  if (
    status === 401 ||
    status === 403 ||
    /unauthor|forbidden|api.?key/u.test(message)
  ) {
    return 'authentication';
  }
  if (name === 'aborterror' || /timeout|timed out/u.test(message)) {
    return 'timeout';
  }
  if (/invalid|unsupported format|schema|parse/u.test(message)) {
    return 'invalid-response';
  }
  if (/storage|quota/u.test(message)) return 'storage';
  if (/network|fetch|offline|connection/u.test(message)) return 'network';
  return 'unknown';
}

function diagnosticId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export async function loadDiagnostics(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<DiagnosticEntry[]> {
  const stored = await storage.get(DIAGNOSTIC_LOG_KEY);
  const value: unknown = stored[DIAGNOSTIC_LOG_KEY];
  return Array.isArray(value) ? value.filter(isDiagnosticEntry) : [];
}

/** Stores only fixed codes and categories; raw errors, URLs and content are excluded. */
export async function recordDiagnostic(
  input: DiagnosticInput,
  storage: chrome.storage.StorageArea = chrome.storage.local,
  now = new Date(),
): Promise<void> {
  const previous = await loadDiagnostics(storage);
  const entry: DiagnosticEntry = {
    id: diagnosticId(),
    at: now.toISOString(),
    severity: input.severity ?? 'error',
    subsystem: input.subsystem,
    operation: input.operation.slice(0, 80),
    code: input.code.slice(0, 80),
    category: input.category ?? classifyDiagnosticError(input.error),
    version: EXTENSION_RUNTIME_VERSION,
  };
  await storage.set({
    [DIAGNOSTIC_LOG_KEY]: [entry, ...previous].slice(
      0,
      STORAGE_RETENTION_LIMITS.diagnostics,
    ),
  });
}

export async function clearDiagnostics(
  storage: chrome.storage.StorageArea = chrome.storage.local,
): Promise<void> {
  await storage.remove(DIAGNOSTIC_LOG_KEY);
}

export function diagnosticsExport(entries: DiagnosticEntry[]): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      entries,
      privacy:
        'No page text, URLs, profile values, API keys, tokens or raw error messages are included.',
    },
    null,
    2,
  );
}
