import { Client } from "pg";
import type { ClientConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type DbIdentity = Readonly<{
  principalId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}>;

/** Resolved by authentication before opening a transaction; never accept these from a request body. */
export type DbSession = Readonly<{
  db: NodePgDatabase;
  identity: DbIdentity;
}>;

export type DatabaseRole = "aval_app" | "aval_benchmark_app";
const roleSql: Record<DatabaseRole, string> = {
  aval_app: "SET LOCAL ROLE aval_app",
  aval_benchmark_app: "SET LOCAL ROLE aval_benchmark_app",
};

/**
 * One request-scoped client; Hyperdrive owns the physical connection pool.
 * Return data/outbox commands from work, commit, THEN call a model/provider.
 * A DbSession must not escape its callback or be shared across requests.
 * No automatic retry: a lost COMMIT acknowledgement has an unknown outcome.
 */
export async function withDbSession<T>(
  config: ClientConfig,
  identity: DbIdentity,
  work: (session: DbSession) => Promise<T>,
  options: { role?: DatabaseRole; readOnly?: boolean; verifyCleanContext?: boolean } = {},
): Promise<T> {
  for (const key of ["principalId", "organizationId", "actorId", "requestId"] as const) {
    const value = identity[key];
    if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) throw new Error("Invalid database identity");
  }
  const role = options.role ?? "aval_app";
  if (!Object.hasOwn(roleSql, role)) throw new Error("Invalid database role");
  const client = new Client({ ...config, connectionTimeoutMillis: 5000, query_timeout: 12000, application_name: "aval-session" });
  let inTransaction = false;
  try {
    await client.connect();
    await client.query(options.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    inTransaction = true;
    if (options.verifyCleanContext) {
      const { rows } = await client.query(`SELECT
        nullif(current_setting('aval.principal_id', true), '') AS principal,
        nullif(current_setting('aval.organization_id', true), '') AS organization,
        nullif(current_setting('aval.actor_id', true), '') AS actor,
        nullif(current_setting('aval.request_id', true), '') AS request`);
      if (Object.values(rows[0]).some((value) => value !== null)) throw new Error("Leaked database transaction context");
    }
    await client.query(roleSql[role]);
    await client.query(`SELECT
      set_config('aval.principal_id', $1, true), set_config('aval.organization_id', $2, true),
      set_config('aval.actor_id', $3, true), set_config('aval.request_id', $4, true),
      set_config('statement_timeout', '8000', true), set_config('lock_timeout', '5000', true),
      set_config('idle_in_transaction_session_timeout', '10000', true),
      set_config('search_path', 'pg_catalog, public', true)`,
    [identity.principalId, identity.organizationId, identity.actorId, identity.requestId]);
    const session = Object.freeze({ db: drizzle(client), identity: Object.freeze({ ...identity }) });
    const result = await work(session);
    await client.query("COMMIT");
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* Discard the broken connection below. */ }
    }
    throw error;
  } finally {
    await client.end();
  }
}
