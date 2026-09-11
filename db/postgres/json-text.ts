import { customType } from "drizzle-orm/pg-core";

/**
 * Keep Aval's existing repository contract while storing structured JSONB.
 *
 * The D1 repositories exchange JSON as strings. node-postgres normally
 * deserializes jsonb to objects, which would make a database-only migration
 * change application behavior in dozens of call sites. This adapter parses on
 * writes and serializes on reads, so PostgreSQL receives native JSON values
 * while the parity layer continues to expose strings.
 */
export const jsonText = customType<{
  data: string;
  driverData: unknown;
}>({
  dataType() {
    return "jsonb";
  },
  toDriver(value) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error("Invalid JSON supplied to a PostgreSQL JSONB column");
    }
  },
  fromDriver(value) {
    return JSON.stringify(value);
  },
});
