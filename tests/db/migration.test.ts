import type { PGlite } from "@electric-sql/pglite"
import { beforeEach, describe, expect, it } from "vitest"
import { A, B, addPlayers, as, baseDb, freshDb, migrationSql, saveDraft, skillMigrationSql } from "./harness"

let db: PGlite
beforeEach(async () => {
  db = await freshDb()
})

const rejects = (p: Promise<unknown>, pattern: RegExp) => expect(p).rejects.toThrow(pattern)

describe("access control", () => {
  it("denies anon every table and the RPC", async () => {
    for (const t of ["players", "sessions", "session_players", "session_matches"]) {
      await rejects(as(db, null, () => db.query(`select * from ${t}`)), /permission denied/)
    }
    await rejects(as(db, null, () => db.query(`select save_session_draft(current_date, '{}', '[]')`)), /permission denied/)
  })

  it("defines no PUBLIC or anon policies and no using(true) policies", async () => {
    const { rows } = await db.query<{ tablename: string; roles: string[]; qual: string | null }>(
      `select tablename, roles, qual from pg_policies where schemaname = 'public'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const p of rows) {
      expect(p.roles).toEqual(["authenticated"])
      expect(p.qual === null || p.qual.trim() !== "true").toBe(true)
    }
  })

  it("has RLS enabled and forced on every public table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    )
    expect(rows.map((r) => r.relname).sort()).toEqual(["players", "session_matches", "session_players", "sessions"])
    for (const r of rows) expect(r.relrowsecurity && r.relforcerowsecurity).toBe(true)
  })

  it("scopes players to their owner", async () => {
    const [a1] = await addPlayers(db, A, ["Ana"])
    await addPlayers(db, B, ["Bea"])
    const seenByA = await as(db, A, () => db.query<{ name: string }>(`select name from players`))
    expect(seenByA.rows.map((r) => r.name)).toEqual(["Ana"])
    // B cannot update or reach A's row
    const upd = await as(db, B, () => db.query(`update players set skill_level = 9 where id = $1`, [a1]))
    expect(upd.affectedRows).toBe(0)
    // B cannot insert a row owned by A
    await rejects(
      as(db, B, () => db.query(`insert into players (owner_id, name, skill_level) values ($1, 'Eve', 3)`, [A])),
      /row-level security/,
    )
  })

  it("never lets a user re-assign ownership", async () => {
    const [a1] = await addPlayers(db, A, ["Ana"])
    await rejects(as(db, A, () => db.query(`update players set owner_id = $1 where id = $2`, [B, a1])), /permission denied/)
  })
})

describe("players", () => {
  it("enforces skill range, trimmed non-empty name, and per-owner case-insensitive uniqueness", async () => {
    const bad = (name: string, skill: number) =>
      as(db, A, () => db.query(`insert into players (name, skill_level) values ($1, $2)`, [name, skill]))
    await rejects(bad("Ana", 0), /check constraint/)
    await rejects(bad("Ana", 6), /check constraint/)
    await rejects(bad("Ana", 10), /check constraint/)
    await rejects(bad("", 3), /check constraint/)
    await rejects(bad(" Ana", 3), /check constraint/)
    for (const skill of [1, 2, 4, 5]) await bad(`Level ${skill}`, skill)
    await bad("Ana", 3)
    await rejects(bad("ANA", 3), /duplicate key/)
    await as(db, B, () => db.query(`insert into players (name, skill_level) values ('Ana', 3)`))
  })

  it("rejects raising an existing player above 5", async () => {
    const [a1] = await addPlayers(db, A, ["Ana"], 5)
    await rejects(as(db, A, () => db.query(`update players set skill_level = 6 where id = $1`, [a1])), /check constraint/)
  })

  it("can be soft-deactivated but not deleted", async () => {
    const [a1] = await addPlayers(db, A, ["Ana"])
    await as(db, A, () => db.query(`update players set active = false where id = $1`, [a1]))
    const { rows } = await as(db, A, () => db.query<{ active: boolean }>(`select active from players where id = $1`, [a1]))
    expect(rows[0].active).toBe(false)
    await rejects(as(db, A, () => db.query(`delete from players where id = $1`, [a1])), /permission denied/)
  })
})

describe("session drafts", () => {
  const four = async (user = A) => addPlayers(db, user, ["P1", "P2", "P3", "P4"])

  it("stores participants and ordered matches with lock states", async () => {
    const p = await addPlayers(db, A, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"])
    await saveDraft(db, A, "2026-11-15", p, [
      { team1: [p[0], p[1]], team2: [p[2], p[3]], locked: true },
      { team1: [p[4], p[5]], team2: [p[6], p[7]] },
    ])
    const { rows } = await as(db, A, () =>
      db.query<{ position: number; locked: boolean; team1_player1_id: string }>(
        `select position, locked, team1_player1_id from session_matches order by position`,
      ),
    )
    expect(rows).toEqual([
      { position: 0, locked: true, team1_player1_id: p[0] },
      { position: 1, locked: false, team1_player1_id: p[4] },
    ])
    const sp = await as(db, A, () => db.query(`select 1 from session_players`))
    expect(sp.rows).toHaveLength(8)
  })

  it("re-saving the same date replaces the draft without creating a second session", async () => {
    const p = await four()
    await saveDraft(db, A, "2026-11-15", p, [{ team1: [p[0], p[1]], team2: [p[2], p[3]] }])
    await saveDraft(db, A, "2026-11-15", p, [{ team1: [p[0], p[2]], team2: [p[1], p[3]], locked: true }])
    const s = await as(db, A, () => db.query(`select 1 from sessions`))
    expect(s.rows).toHaveLength(1)
    const m = await as(db, A, () => db.query<{ team1_player2_id: string; locked: boolean }>(`select team1_player2_id, locked from session_matches`))
    expect(m.rows).toEqual([{ team1_player2_id: p[2], locked: true }])
  })

  it("rejects one session per owner and date at the table level", async () => {
    await as(db, A, () => db.query(`insert into sessions (session_date) values ('2026-11-15')`))
    await rejects(as(db, A, () => db.query(`insert into sessions (session_date) values ('2026-11-15')`)), /duplicate key/)
    await as(db, B, () => db.query(`insert into sessions (session_date) values ('2026-11-15')`))
  })

  it("rejects another owner's players and players outside the participant list", async () => {
    const p = await four()
    const [b1] = await addPlayers(db, B, ["Bea"])
    await rejects(saveDraft(db, A, "2026-11-15", [...p, b1], []), /foreign key/)
    await rejects(
      saveDraft(db, A, "2026-11-16", p.slice(0, 3), [{ team1: [p[0], p[1]], team2: [p[2], p[3]] }]),
      /foreign key|null value/,
    )
  })

  it("rejects a match that repeats a player", async () => {
    const p = await four()
    await rejects(saveDraft(db, A, "2026-11-15", p, [{ team1: [p[0], p[0]], team2: [p[2], p[3]] }]), /check constraint/)
  })

  it("rejects unauthenticated callers inside the function", async () => {
    await rejects(as(db, null, () => db.query(`select 1`)).then(() => db.query(`select save_session_draft(current_date, '{}', '[]')`)), /not authenticated|permission denied/)
  })

  it("does not let a user touch another owner's session or matches", async () => {
    const p = await four()
    await saveDraft(db, A, "2026-11-15", p, [{ team1: [p[0], p[1]], team2: [p[2], p[3]] }])
    expect((await as(db, B, () => db.query(`select 1 from session_matches`))).rows).toHaveLength(0)
    const upd = await as(db, B, () => db.query(`update session_matches set played = true`))
    expect(upd.affectedRows).toBe(0)
    const sess = await as(db, A, () => db.query<{ id: string }>(`select id from sessions`))
    await rejects(
      as(db, B, () =>
        db.query(
          `insert into session_matches (session_id, position, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id)
           values ($1, 9, $2, $3, $4, $5)`,
          [sess.rows[0].id, ...p],
        ),
      ),
      /row-level security|foreign key/,
    )
  })
})

describe("history is preserved", () => {
  async function playedSession() {
    const p = await addPlayers(db, A, ["P1", "P2", "P3", "P4", "P5"])
    await saveDraft(db, A, "2026-11-01", p.slice(0, 4), [{ team1: [p[0], p[1]], team2: [p[2], p[3]] }])
    const m = await as(db, A, () => db.query<{ id: string }>(`select id from session_matches`))
    await as(db, A, () => db.query(`update session_matches set played = true, notes = 'close one' where id = $1`, [m.rows[0].id]))
    return { p, matchId: m.rows[0].id }
  }

  it("keeps played matches when the draft is re-saved and appends new ones after them", async () => {
    const { p, matchId } = await playedSession()
    await saveDraft(db, A, "2026-11-01", p.slice(0, 4), [{ team1: [p[0], p[2]], team2: [p[1], p[3]] }])
    const { rows } = await as(db, A, () => db.query<{ id: string; position: number; played: boolean }>(`select id, position, played from session_matches order by position`))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: matchId, position: 0, played: true })
    expect(rows[1]).toMatchObject({ position: 1, played: false })
  })

  it("refuses to drop a participant that appears in a played match", async () => {
    const { p } = await playedSession()
    await rejects(saveDraft(db, A, "2026-11-01", [p[0], p[1], p[2], p[4]], []), /foreign key/)
  })

  it("refuses to delete played matches, sessions, session players, or players", async () => {
    const { p, matchId } = await playedSession()
    const del = await as(db, A, () => db.query(`delete from session_matches where id = $1`, [matchId]))
    expect(del.affectedRows).toBe(0)
    await rejects(as(db, A, () => db.query(`delete from sessions`)), /permission denied/)
    await rejects(as(db, A, () => db.query(`delete from session_players where player_id = $1`, [p[0]])), /foreign key/)
    await rejects(as(db, A, () => db.query(`delete from players where id = $1`, [p[0]])), /permission denied/)
  })

  it("lets a played match be un-recorded then deleted by a later draft save", async () => {
    const { p, matchId } = await playedSession()
    await as(db, A, () => db.query(`update session_matches set played = false where id = $1`, [matchId]))
    await saveDraft(db, A, "2026-11-01", p.slice(0, 4), [])
    expect((await as(db, A, () => db.query(`select 1 from session_matches`))).rows).toHaveLength(0)
  })

  it("removes everything for a deleted account without tripping the history FKs", async () => {
    await playedSession()
    await db.exec(`delete from auth.users where id = '${A}'`)
    for (const t of ["players", "sessions", "session_players", "session_matches"]) {
      expect((await db.query(`select 1 from ${t}`)).rows).toHaveLength(0)
    }
  })
})

describe("skill 1..5 forward migration", () => {
  const playerRows = (d: PGlite) => d.query<{ name: string; skill_level: number }>(`select name, skill_level from players order by name`)

  it("keeps every existing player and limits skill to 1..5 when nothing is above 5", async () => {
    const old = await baseDb()
    await old.exec(`insert into players (owner_id, name, skill_level) values ('${A}', 'Ana', 5), ('${A}', 'Bo', 1), ('${B}', 'Cy', 3)`)
    await old.exec(skillMigrationSql())
    expect((await playerRows(old)).rows).toEqual([
      { name: "Ana", skill_level: 5 },
      { name: "Bo", skill_level: 1 },
      { name: "Cy", skill_level: 3 },
    ])
    await rejects(old.exec(`insert into players (owner_id, name, skill_level) values ('${A}', 'Dee', 6)`), /check constraint/)
  })

  it("aborts with an explanation and changes nothing when a player is above 5", async () => {
    const old = await baseDb()
    await old.exec(`insert into players (owner_id, name, skill_level) values ('${A}', 'Ana', 8), ('${A}', 'Bo', 3)`)
    await rejects(old.exec(skillMigrationSql()), /above 5/)
    expect((await playerRows(old)).rows).toEqual([
      { name: "Ana", skill_level: 8 },
      { name: "Bo", skill_level: 3 },
    ])
    // the old constraint is still the one in force after the abort
    await old.exec(`insert into players (owner_id, name, skill_level) values ('${A}', 'Cy', 9)`)
  })

  it("can be applied twice", async () => {
    await db.exec(skillMigrationSql())
    await rejects(db.exec(`insert into players (owner_id, name, skill_level) values ('${A}', 'Dee', 6)`), /check constraint/)
  })

  it("only swaps the check constraint: no data writes, grants or policies", () => {
    const sql = skillMigrationSql().replace(/--.*$/gm, "")
    expect(sql).not.toMatch(/\b(grant|revoke|policy|drop\s+table|truncate|delete\s+from|update\s+(public\.)?players)\b/i)
  })
})

describe("migration safety", () => {
  it("refuses to run on top of the legacy v0 schema", async () => {
    const legacy = await freshDb().then(async (d) => {
      await d.exec(`create table match_history (id uuid primary key)`)
      return d
    })
    await rejects(legacy.exec(migrationSql()), /legacy/i)
  })

  it("contains no PUBLIC policies or cascading deletes onto players", () => {
    const sql = migrationSql().replace(/--.*$/gm, "")
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i)
    expect(sql).not.toMatch(/to\s+public|to\s+anon/i)
    expect(sql).not.toMatch(/references\s+(public\.)?players[^,]*on delete cascade/i)
  })
})
