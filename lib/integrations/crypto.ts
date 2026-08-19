const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyFromSecret(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string) {
  if (!secret || secret.length < 24) throw new Error("INTEGRATION_TOKEN_ENCRYPTION_KEY must contain at least 24 characters.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, secret: string) {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Unsupported encrypted token format.");
  const key = await keyFromSecret(secret);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext));
  return new TextDecoder().decode(decrypted);
}
