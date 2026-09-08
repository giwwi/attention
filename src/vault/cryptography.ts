import type { EncryptedRecord } from './database';

export const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encode(bytes: Uint8Array): string {
  let text = '';
  // Chunking avoids argument limits for large imported libraries.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(text);
}

export function decode(
  value: unknown,
  length?: number,
): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('Vault data is damaged.');
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  if (
    (length !== undefined && bytes.length !== length) ||
    encode(bytes) !== value
  )
    throw new Error('Vault data is damaged.');
  return bytes;
}

export function random(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function importDataKey(
  raw: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function passwordKey(
  password: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt, 16), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function context(
  vaultId: string,
  kind: string,
  id: string,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify(['Attention vault', 1, vaultId, kind, id]),
  );
}

export async function encrypt(
  key: CryptoKey,
  vaultId: string,
  kind: string,
  id: string,
  value: unknown,
): Promise<EncryptedRecord> {
  const nonce = random(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: context(vaultId, kind, id) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return {
    version: 1,
    id,
    nonce: encode(nonce),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}

export async function decrypt(
  key: CryptoKey,
  vaultId: string,
  kind: string,
  record: EncryptedRecord,
): Promise<unknown> {
  try {
    if (!record || record.version !== 1 || typeof record.id !== 'string')
      throw new Error();
    const ciphertext = decode(record.ciphertext);
    if (ciphertext.length < 16) throw new Error();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode(record.nonce, 12),
        additionalData: context(vaultId, kind, record.id),
      },
      key,
      ciphertext,
    );
    return JSON.parse(decoder.decode(plaintext)) as unknown;
  } catch {
    throw new Error('Vault data is damaged or could not be authenticated.');
  }
}

/** A logical name never appears in an IndexedDB record identifier. */
export async function recordId(
  raw: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<string> {
  const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('Attention vault v1'),
      info: encoder.encode('Opaque record identifiers'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`Attention record\u0000${name}`),
  );
  return encode(new Uint8Array(signature));
}

export async function recordDigest(record: EncryptedRecord): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(JSON.stringify(record)),
  );
  return encode(new Uint8Array(digest));
}
