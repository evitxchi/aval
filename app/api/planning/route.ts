import { getApiIdentity, isGuestIdentity } from "@/lib/integrations/session";
import { ensureOrganization } from "@/lib/integrations/organizations";
import { listMembers } from "@/lib/organizations/membership";
import {
  createItem,
  createProject,
  deleteItem,
  hasProject,
  readPlanning,
  updateItem,
} from "@/lib/planning/store";
import {
  parseItem,
  PROJECT_COLORS,
  type ProjectColor,
} from "@/lib/planning/types";
const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });
export async function GET(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity || isGuestIdentity(identity))
    return error("Sign in to use workspace planning.", 401);
  try {
    await ensureOrganization(identity);
    const [data, members] = await Promise.all([
      readPlanning(identity.organizationId),
      listMembers(identity.organizationId),
    ]);
    const roster = members.map(({ userId, displayName, email, role }) => ({
      userId,
      displayName,
      email,
      role,
    }));
    // Platform identities can own a workspace without a password-account row.
    if (!roster.some((member) => member.userId === identity.userId)) {
      const { userId, displayName, email, role } = identity;
      roster.unshift({ userId, displayName, email, role });
    }
    return Response.json(
      { ...data, members: roster },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return error("Planning is unavailable. Please try again.", 503);
  }
}
async function mutate(request: Request) {
  const identity = await getApiIdentity(request);
  if (!identity || isGuestIdentity(identity))
    return error("Sign in to use workspace planning.", 401);
  try {
    const raw = await request.text();
    if (raw.length > 16000) return error("Request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return error("Invalid request.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return error("Invalid request.", 400);
    await ensureOrganization(identity);
    if (request.method === "POST" && body.entity === "project") {
      if (
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.length > 160 ||
        typeof body.description !== "string" ||
        body.description.length > 5000 ||
        !PROJECT_COLORS.includes(body.color as ProjectColor)
      )
        return error("Enter a valid project name and color.", 400);
      return Response.json(
        {
          project: await createProject(
            identity.organizationId,
            body.title.trim(),
            body.description.trim(),
            body.color as ProjectColor,
          ),
        },
        { status: 201 },
      );
    }
    if (
      request.method !== "POST" &&
      (typeof body.id !== "string" ||
        !Number.isSafeInteger(body.version) ||
        Number(body.version) < 1)
    )
      return error("An item and its current version are required.", 400);
    if (request.method === "DELETE")
      return (await deleteItem(
        identity.organizationId,
        body.id as string,
        body.version as number,
      ))
        ? Response.json({ ok: true })
        : error(
            "This item changed or is no longer available. Refresh and try again.",
            409,
          );
    const input = parseItem(body);
    if (!input) return error("Check the title, dates, and status.", 400);
    if (
      input.projectId &&
      !(await hasProject(identity.organizationId, input.projectId))
    )
      return error("Project is not in this workspace.", 400);
    if (
      input.assigneeId &&
      input.assigneeId !== identity.userId &&
      !(await listMembers(identity.organizationId)).some(
        (m) => m.userId === input.assigneeId,
      )
    )
      return error("Assignee is not in this workspace.", 400);
    if (request.method === "POST")
      return Response.json(
        {
          item: await createItem(
            identity.organizationId,
            identity.userId,
            input,
          ),
        },
        { status: 201 },
      );
    const item = await updateItem(
      identity.organizationId,
      body.id as string,
      body.version as number,
      input,
    );
    return item
      ? Response.json({ item })
      : error(
          "This item changed or is no longer available. Refresh and try again.",
          409,
        );
  } catch {
    return error("Your changes could not be saved. Please try again.", 503);
  }
}
export const POST = mutate;
export const PUT = mutate;
export const DELETE = mutate;
