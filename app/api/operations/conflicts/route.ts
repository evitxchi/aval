/**
 * GET   /api/operations/conflicts — fields where two connected systems disagree.
 * PATCH /api/operations/conflicts — record which value a person chose.
 *
 * Resolving records the decision; it does not itself write the chosen value
 * back onto the entity. Coercing a stored text value into a typed column
 * generically would be exactly the guess this whole mechanism exists to avoid
 * — see `resolveConflict`.
 */

import { getApiIdentity } from "@/lib/integrations/session";
import { operationsErrorResponse } from "@/lib/operations/errors";
import { listOpenConflicts, resolveConflict } from "@/lib/operations/provenance";
import { CONFLICT_RESOLUTIONS } from "@/lib/operations/types";
import { parseLimit, readJsonBody, requireEnum, requireString } from "@/lib/operations/validation";

export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const conflicts = await listOpenConflicts(identity.organizationId, parseLimit(new URL(request.url), 100, 500));
  return Response.json({ conflicts });
}

export async function PATCH(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const body = await readJsonBody(request);
    const resolved = await resolveConflict(
      identity.organizationId,
      requireString(body, "conflictId", 64),
      requireEnum(body, "resolution", CONFLICT_RESOLUTIONS),
    );
    if (!resolved) return Response.json({ error: "Conflict not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return operationsErrorResponse(error);
  }
}
