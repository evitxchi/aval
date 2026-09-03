import { getApiIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { forgetPreference, listPreferenceOptions, listPreferences, setPreferenceFromSetup, PREFERENCE_TOPICS, type PreferenceTopic } from "@/lib/ask-aval/preferences";

/**
 * What this workspace has taught Aval. These rows are read back into every
 * future Ask Aval system prompt (getPreferenceContext), so this is the same
 * memory the assistant actually reasons with — not a separate display copy.
 */
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  await ensureOrganization(identity);
  const [taught, options] = await Promise.all([listPreferences(identity.organizationId), Promise.resolve(listPreferenceOptions())]);
  return Response.json({ taught, options });
}

/** POST { topic, statement } — teach one fact. Both must come from the fixed taxonomy. */
export async function POST(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { topic?: string; statement?: string };
  const topic = body.topic;
  const statement = body.statement;
  if (!topic || !statement || !(topic in PREFERENCE_TOPICS)) {
    return Response.json({ error: "Unknown preference" }, { status: 400 });
  }
  await ensureOrganization(identity);
  const saved = await setPreferenceFromSetup(identity.organizationId, topic as PreferenceTopic, statement);
  if (!saved) return Response.json({ error: "Unknown preference" }, { status: 400 });
  return Response.json({ taught: await listPreferences(identity.organizationId) });
}

/** DELETE ?topic=… — forget one topic. */
export async function DELETE(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const topic = new URL(request.url).searchParams.get("topic");
  if (!topic || !(topic in PREFERENCE_TOPICS)) return Response.json({ error: "Unknown preference" }, { status: 400 });
  await ensureOrganization(identity);
  await forgetPreference(identity.organizationId, topic);
  return Response.json({ taught: await listPreferences(identity.organizationId) });
}
