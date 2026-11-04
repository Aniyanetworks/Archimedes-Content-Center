// Signed review links: base64url(payload).base64url(HMAC-SHA256). The payload is integrity-protected,
// and the database row for its jti is what makes a link revocable and single-decision.

export interface ReviewClaims {
  jti: string;
  cid: string; // campaign
  tid: string; // tenant
  hash: string; // exact rendered version
  exp: number; // unix seconds
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signToken(claims: ReviewClaims, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns null for anything malformed, tampered with or expired. crypto.subtle.verify is constant-time.
export async function verifyToken(token: string, secret: string, nowSeconds = Date.now() / 1000): Promise<ReviewClaims | null> {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const claims = JSON.parse(decoder.decode(fromBase64Url(parts[0]))) as ReviewClaims;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
