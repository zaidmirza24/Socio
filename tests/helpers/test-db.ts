/**
 * A throwaway Postgres for tests: PGlite (real Postgres compiled to WebAssembly, in-process, no
 * Docker) with every migration in supabase/migrations applied in order, exactly as in production.
 *
 * Supabase provides a few things plain Postgres lacks; they are stubbed here and nowhere else:
 * the anon / authenticated / service_role roles and a minimal `auth` schema (users, uid(), role()).
 */
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS_DIR = new URL("../../supabase/migrations/", import.meta.url);

const SUPABASE_STUBS = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
`;

/** Migration file names in the order they are applied (date-prefixed, so a name sort). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { uuid_ossp, pg_trgm } });
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), "utf8");
    try {
      await db.exec(sql);
    } catch (err: unknown) {
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return db;
}
