import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.LOCAL_DB_PATH || "./data/local.db",
  },
} satisfies Config;
