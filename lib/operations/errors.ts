/**
 * The errors the operations layer throws, and the single place that turns them
 * into HTTP responses.
 *
 * Kept in their own module so an API route can import the error handling
 * without importing a repository — and with it `@/db` and the Cloudflare D1
 * binding — into a path that may not touch the database at all. Same reason
 * `lib/integrations/organizations.ts` was split out of `session.ts`.
 */

import { ValidationError } from "./validation";

export class EntityNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found in this organization`);
    this.name = "EntityNotFoundError";
  }
}

/**
 * Maps a thrown error to a response.
 *
 * A missing entity is a **404, not a 403**, whether it does not exist or
 * belongs to another workspace. Distinguishing the two would let a caller
 * enumerate which ids exist in other organizations by watching the status
 * code — the lookups themselves are already org-scoped, and this keeps the
 * response from leaking what they found.
 *
 * Anything unrecognized is re-thrown rather than swallowed into a 500 with a
 * friendly message. A bug in a metric should surface in the logs as itself.
 */
export function operationsErrorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message, field: error.field }, { status: 400 });
  }
  if (error instanceof EntityNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  throw error;
}
