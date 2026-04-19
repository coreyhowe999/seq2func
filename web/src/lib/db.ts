import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";
import { getRequestContext } from "@cloudflare/next-on-pages";

/*
 * D1-only DB access. All routes that touch the DB must run on the edge runtime
 * (`export const runtime = "edge"`) so that `getRequestContext()` resolves.
 *
 * In local development via `wrangler pages dev`, the D1 binding resolves to a
 * local SQLite file under .wrangler/state/v3/d1. `next dev` does NOT have
 * access to Cloudflare bindings — use the `pages:dev` npm script for local
 * end-to-end testing against a real D1 instance.
 */
export type DrizzleDB = DrizzleD1Database<typeof schema>;

export function getDb(): DrizzleDB {
  const { env } = getRequestContext();
  const d1 = (env as unknown as { DB: D1Database }).DB;
  if (!d1) {
    throw new Error("D1 binding 'DB' is not available — check wrangler.toml and runtime=edge");
  }
  return drizzle(d1, { schema });
}
