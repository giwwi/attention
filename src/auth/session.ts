export const PUBLIC_SESSION_KEY = 'publicSession';

export interface PublicExtensionSession {
  accessToken: string;
  subject: string;
  expiresAt: string;
}

function isPublicExtensionSession(
  value: unknown,
): value is PublicExtensionSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.accessToken === 'string' &&
    session.accessToken.startsWith('attn1.') &&
    typeof session.subject === 'string' &&
    session.subject.length > 0 &&
    typeof session.expiresAt === 'string' &&
    Number.isFinite(new Date(session.expiresAt).getTime())
  );
}

export async function loadPublicSession(
  storage: chrome.storage.StorageArea = chrome.storage.session,
  now = new Date(),
): Promise<PublicExtensionSession | null> {
  const stored = await storage.get(PUBLIC_SESSION_KEY);
  const value: unknown = stored[PUBLIC_SESSION_KEY];
  if (!isPublicExtensionSession(value)) return null;
  if (new Date(value.expiresAt).getTime() <= now.getTime()) {
    await storage.remove(PUBLIC_SESSION_KEY);
    return null;
  }
  return value;
}

export async function savePublicSession(
  session: PublicExtensionSession,
  storage: chrome.storage.StorageArea = chrome.storage.session,
): Promise<void> {
  if (!isPublicExtensionSession(session)) {
    throw new Error('Invalid public session.');
  }
  await storage.set({ [PUBLIC_SESSION_KEY]: session });
}

export async function clearPublicSession(
  storage: chrome.storage.StorageArea = chrome.storage.session,
): Promise<void> {
  await storage.remove(PUBLIC_SESSION_KEY);
}
