import { clearSessionCookie } from "@/lib/auth/session-cookie";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": clearSessionCookie(), "cache-control": "no-store" },
  });
}
