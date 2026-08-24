/**
 * PBKDF2 password hashing via Web Crypto (SubtleCrypto) — the crypto
 * available in the Workers runtime; no native bcrypt/argon2 module exists
 * there. Stored as `pbkdf2$<iterations>$<saltHex>$<hashHex>` so the
 * iteration count can be raised later without invalidating old hashes.
 */

// OWASP's current guidance for PBKDF2-HMAC-SHA256 is 600k+, but Cloudflare
// Workers' WebCrypto hard-caps PBKDF2 at 100k iterations and throws
// NotSupportedError above that (unlike Node, where this was benchmarked —
// Node has no such cap, so the benchmark didn't catch it). 100k is this
// platform's real ceiling, not a choice. The stored format is versioned by
// iteration count (`pbkdf2$<iterations>$...`) regardless, so raising this
// later — on a different runtime, or if Workers lifts the cap — only
// affects hashes created from that point on.
const ITERATIONS = 100_000;
const KEY_LENGTH_BITS = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, KEY_LENGTH_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !saltHex || !hashHex) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations)) return false;
  const bits = await deriveBits(password, fromHex(saltHex), iterations);
  const computedHex = toHex(bits);
  if (computedHex.length !== hashHex.length) return false;
  // Constant-time-ish comparison — length is already equal-checked above,
  // and this loop always runs to completion regardless of where a
  // mismatch occurs, so it doesn't leak position via timing.
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
