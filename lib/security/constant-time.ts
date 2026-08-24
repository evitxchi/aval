/**
 * Constant-time string comparison for verifying HMAC signatures (webhook
 * secrets, session/CSRF tokens). A plain `===` short-circuits on the first
 * mismatched character, so its runtime leaks how many leading characters of
 * a guess were correct — enough for a patient attacker to recover a secret
 * byte-by-byte over many requests. This always walks the full length.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
