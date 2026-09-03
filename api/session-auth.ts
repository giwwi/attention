const TOKEN_PREFIX = 'attn1';
const MAX_SESSION_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;

export interface PublicSessionClaims {
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(
      value.replaceAll('-', '+').replaceAll('_', '/') + padding,
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function isClaims(value: unknown): value is PublicSessionClaims {
  if (!value || typeof value !== 'object') return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.sub === 'string' &&
    claims.sub.length > 0 &&
    claims.sub.length <= 160 &&
    typeof claims.aud === 'string' &&
    claims.aud.length > 0 &&
    claims.aud.length <= 120 &&
    typeof claims.iat === 'number' &&
    Number.isInteger(claims.iat) &&
    typeof claims.exp === 'number' &&
    Number.isInteger(claims.exp) &&
    typeof claims.jti === 'string' &&
    claims.jti.length > 0 &&
    claims.jti.length <= 160
  );
}

export async function issuePublicSessionToken(
  claims: PublicSessionClaims,
  secret: string,
): Promise<string> {
  if (!isClaims(claims) || claims.exp <= claims.iat) {
    throw new Error('Invalid public session claims.');
  }
  if (claims.exp - claims.iat > MAX_SESSION_SECONDS) {
    throw new Error('Public session lifetime is too long.');
  }
  const payload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const signedValue = `${TOKEN_PREFIX}.${payload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importKey(secret),
    new TextEncoder().encode(signedValue),
  );
  return `${signedValue}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPublicSessionAuthorization(
  authorization: string | null,
  secret: string,
  audience: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<PublicSessionClaims | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  const [prefix, payload, signature, extra] = token.split('.');
  if (prefix !== TOKEN_PREFIX || !payload || !signature || extra) return null;
  const signatureBytes = decodeBase64Url(signature);
  const payloadBytes = decodeBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const signedValue = `${prefix}.${payload}`;
  const validSignature = await crypto.subtle.verify(
    'HMAC',
    await importKey(secret),
    new Uint8Array(signatureBytes).buffer,
    new TextEncoder().encode(signedValue),
  );
  if (!validSignature) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.aud !== audience) return null;
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) return null;
  if (claims.exp - claims.iat > MAX_SESSION_SECONDS) return null;
  return claims;
}
