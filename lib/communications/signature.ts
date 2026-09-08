import { constantTimeEqual } from '../security/constant-time.ts';
export async function verifyTwilio(request: Request, raw: string, token: string): Promise<boolean> {
  const signature = request.headers.get('x-twilio-signature');
  if (!signature || !token || !request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) return false;
  const values = new URLSearchParams(raw);
  const text = request.url + [...values.keys()].filter((k,i,a) => a.indexOf(k) === i).sort().map(k => [...new Set(values.getAll(k))].sort().map(v => k + v).join('')).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return constantTimeEqual(signature, btoa(String.fromCharCode(...digest)));
}
