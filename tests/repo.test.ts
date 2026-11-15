import { beforeEach, describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { createPlayer, getSession, listHistory, listPlayers, saveSessionDraft, setMatchPlayed, updatePlayer } from "@/lib/repo"
import { MemoryStore } from "./helpers/memory-store"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DATE = "2026-11-15"

let store: MemoryStore
beforeEach(() => {
  store = new MemoryStore()
})

async function roster(n = 8) {
  const players = []
  for (let i = 1; i <= n; i++) players.push(await createPlayer(store, { name: `Player ${i}`, skill_level: (i % 5) + 1 }))
  return players
}
const draftOf = (ids: string[], locked = [false, false]) => ({
  participants: ids,
  matches: [
    { team1: [ids[0], ids[1]] as [string, string], team2: [ids[2], ids[3]] as [string, string], locked: locked[0] },
    ...(ids.length >= 8 ? [{ team1: [ids[4], ids[5]] as [string, string], team2: [ids[6], ids[7]] as [string, string], locked: locked[1] }] : []),
  ],
})
const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const err = await p.catch((e) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({ status, code })
}

describe("players", () => {
  it("creates a player with a uuid, trimmed-by-validation name, active=true and an ISO created_at", async () => {
    const p = await createPlayer(store, { name: "Ana", skill_level: 3 })
    expect(p.id).toMatch(UUID)
    expect(p).toMatchObject({ name: "Ana", skill_level: 3, active: true })
    expect(new Date(p.created_at!).toISOString()).toBe(p.created_at)
    expect(await listPlayers(store)).toEqual([p])
  })

  it("rejects a duplicate name case-insensitively with 409 conflict", async () => {
    await createPlayer(store, { name: "Ana", skill_level: 3 })
    await rejects(createPlayer(store, { name: "ANA", skill_level: 1 }), 409, "conflict")
    expect(await listPlayers(store)).toHaveLength(1)
  })

  it("lists players ordered by name", async () => {
    await createPlayer(store, { name: "Zoe", skill_level: 1 })
    await createPlayer(store, { name: "ana", skill_level: 1 })
    await createPlayer(store, { name: "Bo", skill_level: 1 })
    expect((await listPlayers(store)).map((p) => p.name)).toEqual(["ana", "Bo", "Zoe"])
  })

  it("updates fields, keeping uniqueness on rename (but allowing a case change of its own name)", async () => {
    const ana = await createPlayer(store, { name: "Ana", skill_level: 3 })
    await createPlayer(store, { name: "Bo", skill_level: 3 })
    await rejects(updatePlayer(store, ana.id, { name: "bo" }), 409, "conflict")
    expect(await updatePlayer(store, ana.id, { name: "ANA", skill_level: 5 })).toMatchObject({ name: "ANA", skill_level: 5 })
    expect(await updatePlayer(store, ana.id, { active: false })).toMatchObject({ active: false, name: "ANA" })
  })

  it("returns null for an unknown player and never deletes", async () => {
    expect(await updatePlayer(store, "00000000-0000-4000-8000-000000000001", { active: false })).toBeNull()
    const ana = await createPlayer(store, { name: "Ana", skill_level: 3 })
    await updatePlayer(store, ana.id, { active: false })
    expect(await listPlayers(store)).toHaveLength(1)
  })
})

describe("session drafts", () => {
  it("returns null for a date without a session", async () => {
    expect(await getSession(store, DATE)).toBeNull()
  })

  it("rejects participants that are not players with 422 invalid_players, saving nothing", async () => {
    const ps = await roster(4)
    const ids = ps.map((p) => p.id)
    await rejects(saveSessionDraft(store, DATE, { participants: [...ids.slice(0, 3), "00000000-0000-4000-8000-000000000009"], matches: [] }), 422, "invalid_players")
    expect(await getSession(store, DATE)).toBeNull()
  })

  it("saves participants and matches with positions, locks, new ids and updated_at", async () => {
    const ids = (await roster()).map((p) => p.id)
    const session = await saveSessionDraft(store, DATE, draftOf(ids, [true, false]))
    expect(session.date).toBe(DATE)
    expect(session.participants).toEqual(ids)
    expect(session.matches).toHaveLength(2)
    expect(session.matches.map((m) => [m.position, m.locked, m.played, m.notes])).toEqual([
      [0, true, false, null],
      [1, false, false, null],
    ])
    expect(session.matches[0].id).toMatch(UUID)
    expect(session.matches[0].team1).toEqual([ids[0], ids[1]])
    expect(await getSession(store, DATE)).toEqual(session)
    expect(new Date(store.doc!.sessions[DATE].updated_at).toISOString()).toBe(store.doc!.sessions[DATE].updated_at)
  })

  it("does not leak storage-only fields through getSession", async () => {
    const ids = (await roster()).map((p) => p.id)
    const session = await saveSessionDraft(store, DATE, draftOf(ids))
    expect(Object.keys(session.matches[0]).sort()).toEqual(["id", "locked", "notes", "played", "position", "team1", "team2"])
  })

  it("replaces unplayed matches (dropping the old ones) on every save", async () => {
    const ids = (await roster()).map((p) => p.id)
    const first = await saveSessionDraft(store, DATE, draftOf(ids))
    const second = await saveSessionDraft(store, DATE, { participants: ids, matches: [draftOf(ids).matches[1]] })
    expect(second.matches).toHaveLength(1)
    expect(second.matches[0].id).not.toBe(first.matches[0].id)
    expect(second.matches[0].position).toBe(0)
  })

  it("keeps played matches and appends the new ones after the highest kept position", async () => {
    const ids = (await roster()).map((p) => p.id)
    const first = await saveSessionDraft(store, DATE, draftOf(ids))
    await setMatchPlayed(store, first.matches[1].id, { played: true, notes: "good" })
    const second = await saveSessionDraft(store, DATE, { participants: ids, matches: [draftOf(ids).matches[0]] })
    expect(second.matches.map((m) => [m.id === first.matches[1].id, m.position, m.played])).toEqual([
      [true, 1, true],
      [false, 2, false],
    ])
    expect(second.matches[0].notes).toBe("good")
  })

  it("refuses to remove a participant used by a kept played match (409 in_use) and changes nothing", async () => {
    const ids = (await roster()).map((p) => p.id)
    const first = await saveSessionDraft(store, DATE, draftOf(ids))
    await setMatchPlayed(store, first.matches[0].id, { played: true })
    const before = JSON.stringify(store.doc)
    await rejects(saveSessionDraft(store, DATE, { participants: ids.slice(1), matches: [] }), 409, "in_use")
    expect(JSON.stringify(store.doc)).toBe(before)
  })

  it("lets participants of unplayed matches be removed", async () => {
    const ids = (await roster()).map((p) => p.id)
    await saveSessionDraft(store, DATE, draftOf(ids))
    const session = await saveSessionDraft(store, DATE, { participants: ids.slice(0, 4), matches: [] })
    expect(session.participants).toEqual(ids.slice(0, 4))
    expect(session.matches).toEqual([])
  })

  it("rejects a match with repeated players or a non-participant as invalid_request", async () => {
    const ids = (await roster()).map((p) => p.id)
    await rejects(saveSessionDraft(store, DATE, { participants: ids.slice(0, 4), matches: [{ team1: [ids[0], ids[0]], team2: [ids[2], ids[3]], locked: false }] }), 400, "invalid_request")
    await rejects(saveSessionDraft(store, DATE, { participants: ids.slice(0, 4), matches: [{ team1: [ids[0], ids[1]], team2: [ids[2], ids[7]], locked: false }] }), 400, "invalid_request")
    expect(await getSession(store, DATE)).toBeNull()
  })

  it("keeps sessions of other dates untouched", async () => {
    const ids = (await roster()).map((p) => p.id)
    await saveSessionDraft(store, "2026-11-14", draftOf(ids))
    await saveSessionDraft(store, DATE, { participants: ids.slice(0, 4), matches: [] })
    expect((await getSession(store, "2026-11-14"))!.matches).toHaveLength(2)
  })
})

describe("marking matches played", () => {
  it("sets played and notes, finding the match in any session", async () => {
    const ids = (await roster()).map((p) => p.id)
    await saveSessionDraft(store, "2026-11-14", draftOf(ids))
    const other = await saveSessionDraft(store, DATE, draftOf(ids))
    const match = await setMatchPlayed(store, other.matches[1].id, { played: true, notes: "n" })
    expect(match).toMatchObject({ id: other.matches[1].id, played: true, notes: "n" })
    expect((await getSession(store, DATE))!.matches[1].played).toBe(true)
    expect((await getSession(store, "2026-11-14"))!.matches.every((m) => !m.played)).toBe(true)
  })

  it("clears notes when none are supplied and un-records on played=false", async () => {
    const ids = (await roster()).map((p) => p.id)
    const s = await saveSessionDraft(store, DATE, draftOf(ids))
    await setMatchPlayed(store, s.matches[0].id, { played: true, notes: "n" })
    expect(await setMatchPlayed(store, s.matches[0].id, { played: true })).toMatchObject({ played: true, notes: null })
    expect(await setMatchPlayed(store, s.matches[0].id, { played: false })).toMatchObject({ played: false, notes: null })
  })

  it("returns null for an unknown match", async () => {
    expect(await setMatchPlayed(store, "00000000-0000-4000-8000-000000000001", { played: true })).toBeNull()
  })
})

describe("history", () => {
  it("is empty without played matches", async () => {
    expect(await listHistory(store)).toEqual([])
  })

  it("lists only played matches with their session date, newest first, in the analyzer shape", async () => {
    const ids = (await roster()).map((p) => p.id)
    const older = await saveSessionDraft(store, "2026-11-01", draftOf(ids))
    const newer = await saveSessionDraft(store, "2026-11-10", draftOf(ids))
    await setMatchPlayed(store, older.matches[0].id, { played: true })
    await setMatchPlayed(store, newer.matches[1].id, { played: true, notes: "late" })
    const history = await listHistory(store)
    expect(history.map((h) => [h.id, h.played_at])).toEqual([
      [newer.matches[1].id, "2026-11-10"],
      [older.matches[0].id, "2026-11-01"],
    ])
    expect(history[0]).toMatchObject({
      player1_id: ids[4],
      player2_id: ids[5],
      player3_id: ids[6],
      player4_id: ids[7],
      team1_player1_id: ids[4],
      team2_player2_id: ids[7],
      notes: "late",
    })
    expect(typeof history[0].created_at).toBe("string")
  })

  it("drops a match from history when it is un-recorded", async () => {
    const ids = (await roster()).map((p) => p.id)
    const s = await saveSessionDraft(store, DATE, draftOf(ids))
    await setMatchPlayed(store, s.matches[0].id, { played: true })
    await setMatchPlayed(store, s.matches[0].id, { played: false })
    expect(await listHistory(store)).toEqual([])
  })
})
