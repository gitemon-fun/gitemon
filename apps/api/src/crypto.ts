const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** `payload.signature`, both base64url. */
export async function sign(payload: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return `${b64u(enc.encode(payload))}.${b64u(sig)}`;
}

export async function verify(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  try {
    const payload = dec.decode(unb64u(p));
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      unb64u(s),
      enc.encode(payload),
    );
    return ok ? payload : null;
  } catch {
    return null;
  }
}

async function aesKey(b64: string) {
  return crypto.subtle.importKey('raw', unb64u(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(keyB64),
    enc.encode(plain),
  );
  return `${b64u(iv)}.${b64u(ct)}`;
}

export async function decrypt(box: string | null, keyB64: string): Promise<string | null> {
  if (!box) return null;
  const [iv, ct] = box.split('.');
  if (!iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64u(iv) },
      await aesKey(keyB64),
      unb64u(ct),
    );
    return dec.decode(pt);
  } catch {
    return null;
  }
}

export function randomId(bytes = 16): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time string compare for bearer keys. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
