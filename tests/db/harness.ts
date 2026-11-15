import { readFileSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"

export const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/20261115000000_persistent_scheduler.sql")

export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

/**
 * Minimal stand-in for what Supabase provides before user migrations run:
 * the anon/authenticated roles, auth.users and auth.uid(). Everything else is
 * the real migration executed on real Postgres (PGlite).
 */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`

export function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8")
}

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  await db.exec(migrationSql())
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`)
  return db
}

/** Runs fn as an authenticated Supabase user (RLS applies), then restores the superuser. */
export async function as<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""])
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

export async function addPlayers(db: PGlite, userId: string, names: string[], skill = 3): Promise<string[]> {
  return as(db, userId, async () => {
    const ids: string[] = []
    for (const name of names) {
      const r = await db.query<{ id: string }>(`insert into players (name, skill_level) values ($1, $2) returning id`, [name, skill])
      ids.push(r.rows[0].id)
    }
    return ids
  })
}

export async function saveDraft(
  db: PGlite,
  userId: string,
  date: string,
  participants: string[],
  matches: { team1: string[]; team2: string[]; locked?: boolean }[],
) {
  return as(db, userId, () =>
    db.query<{ id: string }>(`select save_session_draft($1::date, $2::uuid[], $3::jsonb) as id`, [
      date,
      participants,
      JSON.stringify(matches),
    ]),
  )
}
