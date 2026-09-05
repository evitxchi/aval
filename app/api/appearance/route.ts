import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { parseAppearance } from "@/lib/appearance";
import { readAppearance, writeAppearance } from "@/lib/appearance-storage";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity || isGuestIdentity(identity)) return Response.json({ error: "Sign in to sync appearance." }, { status: 401 });
  try {
    return Response.json({ appearance: await readAppearance(identity.userId) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Appearance could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity || isGuestIdentity(identity)) return Response.json({ error: "Sign in to sync appearance." }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 20000) return Response.json({ error: "Appearance is too large." }, { status: 413 });
  let appearance;
  try { appearance = parseAppearance(JSON.parse(raw)); } catch { /* Invalid JSON. */ }
  if (!appearance) return Response.json({ error: "Choose a valid avatar and motion setting." }, { status: 400 });
  try {
    await writeAppearance(identity.userId, appearance);
    return Response.json({ appearance });
  } catch {
    return Response.json({ error: "Appearance could not be saved. Please try again." }, { status: 503 });
  }
}
