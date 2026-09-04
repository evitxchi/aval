/**
 * The financial reservation statement, built as a value rather than issued.
 *
 * It lives outside `financial-operations.ts` for the same reason the other
 * `*-rules` modules do: that file resolves the D1 binding at module scope, so
 * a node test cannot load it, and the statement is precisely the part that has
 * to be exactly right. A rolling cap checked by a separate `SELECT` before an
 * `INSERT` is not a cap — two approved operations both read the same remaining
 * budget and both spend it. Here the cap is the insert's own predicate, so
 * SQLite arbitrates it at write time, and a test can render this and run it
 * against the project's real migrations.
 */

import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { agentFinancialOperations } from "../../db/schema.ts";

const operations = agentFinancialOperations;

export type FinancialReservationRow = typeof agentFinancialOperations.$inferSelect;

/**
 * Statuses that still hold budget. `failed` and `reversed` are excluded: money
 * that did not move, or moved back, must not keep the workspace capped.
 */
export const SPENDING_STATUSES = ["reserved", "submitted", "settled", "unknown"] as const;

/**
 * Both halves of the INSERT are derived from the table definition itself, so a
 * column added to the schema cannot end up in the name list without its value
 * — the drift that a hand-aligned pair of 23-item lists invites.
 */
export function financialReservationStatement(
  row: FinancialReservationRow,
  limit: { dailyLimitCents: number; since: Date },
): SQL {
  const columns = Object.entries(getTableColumns(operations)) as [keyof FinancialReservationRow, AnySQLiteColumn][];
  // Bare identifiers: a column interpolated directly renders table-qualified,
  // which is correct in a predicate and a syntax error in an INSERT name list.
  const names = sql.join(columns.map(([, column]) => sql.identifier(column.name)), sql`, `);
  const values = sql.join(columns.map(([key]) => sql`${toParameter(row[key])}`), sql`, `);
  const spending = sql.join(SPENDING_STATUSES.map((status) => sql`${status}`), sql`, `);

  return sql`
    insert into ${operations} (${names})
    select ${values}
    where (
      select coalesce(sum(${operations.amountCents}), 0)
      from ${operations}
      where ${operations.organizationId} = ${row.organizationId}
        and ${operations.createdAt} > ${limit.since.getTime()}
        and ${operations.status} in (${spending})
    ) + ${row.amountCents} <= ${limit.dailyLimitCents}
  `;
}

/** Raw parameters bypass drizzle's column mappers, so timestamps are widened here. */
function toParameter(value: unknown): string | number | null {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined) return null;
  return value as string | number;
}
