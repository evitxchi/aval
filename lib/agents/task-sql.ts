/**
 * Raw predicates for the task queries, built as pure values.
 *
 * Same reason as `financial-reservation-sql.ts`: `tasks.ts` resolves the D1
 * binding at module scope, so nothing in it can be loaded by a node test, and
 * a raw template is exactly where a query stops being checked by the compiler.
 * A value interpolated into `sql` bypasses the column's mapper and is handed
 * straight to the driver, so a `Date` that reads perfectly well in TypeScript
 * is a runtime failure — neither D1 nor node:sqlite can bind an object.
 */

import { sql, type SQL } from "drizzle-orm";
import { agentTasks } from "../../db/schema.ts";

/**
 * True for a parked task whose most recent approval request has been settled
 * or has run out of time — the two conditions that make it worth waking.
 *
 * Scoped to the *latest* step's request so an older, already-decided approval
 * cannot wake a task that is parked on a newer one.
 */
export function latestApprovalSettledPredicate(now: Date): SQL {
  return sql`exists (
        select 1 from agent_approvals a
        where a.task_id = ${agentTasks.id}
          and a.step_index = (select max(a2.step_index) from agent_approvals a2 where a2.task_id = ${agentTasks.id})
          and (a.status <> 'pending' or a.expires_at < ${now.getTime()})
      )`;
}
