import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryStore } from "./helpers/memory-store"

const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock("@/lib/store-instance", () => ({ getStore: () => holder.store }))
import * as historyRoute from "@/app/api/history/route"
import { signSession, SESSION_COOKIE } from "@/lib/auth"
import { MatchAnalyzer } from "@/lib/match-analyzer"
import { createPlayer, saveSessionDraft, listHistory } from "@/lib/repo"

const pass = "historical test passcode"
const ctx = { params: Promise.resolve({}) } as never
const request = (body: unknown, cookie = true) => new Request("http://localhost/api/history", {
  method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie: `${SESSION_COOKIE}=${signSession(pass, Date.now() + 3600000)}` } : {}) }, body: JSON.stringify(body),
}) as never
let store: MemoryStore
beforeEach(() => { store = new MemoryStore(); holder.store = store; vi.stubEnv("APP_PASSCODE", pass); vi.stubEnv("VERCEL", "") })

describe("manual historical entry", () => {
  it("appends a played match without replacing a saved draft and exposes it in history", async () => {
    const players = await Promise.all([1,2,3,4,5].map(n => createPlayer(store, { name: `Player ${n}`, skill_level: 2 })))
    const ids = players.map(p => p.id)
    const existing = await saveSessionDraft(store, "2020-01-02", { participants: ids.slice(0,4), matches: [{ team1: [ids[0],ids[1]], team2: [ids[2],ids[3]], locked: true }] })
    expect(historyRoute).toHaveProperty("POST")
    const res = await historyRoute.POST(request({ date: "2020-01-02", team1: [ids[0],ids[4]], team2: [ids[2],ids[3]] }), ctx)
    expect(res.status).toBe(201)
    const session = store.doc!.sessions["2020-01-02"]
    expect(session.participants).toEqual(ids)
    expect(session.matches).toHaveLength(2)
    expect(session.matches[0].id).toBe(existing.matches[0].id)
    expect(session.matches[0].played).toBe(false)
    expect(session.matches[1]).toMatchObject({ position: 1, played: true, team1: [ids[0],ids[4]], team2: [ids[2],ids[3]] })
    const history = await listHistory(store)
    expect(history).toMatchObject([{ played_at: "2020-01-02", team1_player1_id: ids[0], team1_player2_id: ids[4] }])
    const team1: [typeof players[number], typeof players[number]] = [players[0], players[4]]
    const team2: [typeof players[number], typeof players[number]] = [players[2], players[3]]
    expect(new MatchAnalyzer(history, players, { referenceDate: "2020-01-03" }).scoreMatch(team1, team2).totalScore)
      .toBeGreaterThan(new MatchAnalyzer([], players, { referenceDate: "2020-01-03" }).scoreMatch(team1, team2).totalScore)
  })
  it("rejects duplicate players, invalid and future dates, unknown players and unauthenticated calls without writing", async () => {
    const ids: string[] = []
    for (let n = 1; n <= 4; n++) ids.push((await createPlayer(store, { name: `P${n}`, skill_level: 2 })).id)
    const valid = { date: "2020-01-02", team1: [ids[0], ids[1]], team2: [ids[2], ids[3]] }
    const before = structuredClone(store.doc)
    for (const body of [
      { ...valid, date: "2020-02-30" }, { ...valid, date: "9999-12-31" },
      { ...valid, team2: [ids[0], ids[3]] }, { ...valid, team1: ["bad", ids[1]] },
    ]) expect((await historyRoute.POST(request(body), ctx)).status).toBe(400)
    const missing = "00000000-0000-4000-8000-000000000001"
    const unknown = await historyRoute.POST(request({ ...valid, team2: [missing, ids[3]] }), ctx)
    expect(unknown.status).toBe(422)
    expect(await unknown.json()).toEqual({ error: "invalid_players" })
    expect((await historyRoute.POST(request(valid, false), ctx)).status).toBe(401)
    expect(store.doc).toEqual(before)
  })

})

it("accepts a date that is already today in UTC+14 while rejecting later dates", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-03-01T12:30:00Z"))
  try {
    const ids = []
    for (let n = 1; n <= 4; n++) ids.push((await createPlayer(store, { name: `T${n}`, skill_level: 2 })).id)
    const teams = { team1: ids.slice(0, 2), team2: ids.slice(2, 4) }
    expect((await historyRoute.POST(request({ ...teams, date: "2026-03-02" }), ctx)).status).toBe(201)
    expect((await historyRoute.POST(request({ ...teams, date: "2026-03-03" }), ctx)).status).toBe(400)
  } finally { vi.useRealTimers() }
})

it("never deletes a newly added historical match when a stale or current draft is saved", async () => {
  const ids = []
  for (let n = 1; n <= 8; n++) ids.push((await createPlayer(store, { name: `S${n}`, skill_level: 2 })).id)
  const date = "2020-01-02"
  const oldDraft = { participants: ids.slice(0, 4), matches: [{ team1: [ids[0], ids[1]] as [string, string], team2: [ids[2], ids[3]] as [string, string], locked: true }] }
  await saveSessionDraft(store, date, oldDraft)
  const response = await historyRoute.POST(request({ date, team1: ids.slice(4, 6), team2: ids.slice(6, 8) }), ctx)
  const added = await response.json()
  await expect(saveSessionDraft(store, date, oldDraft)).rejects.toMatchObject({ code: "in_use" })
  expect((await listHistory(store)).map(row => row.id)).toContain(added.id)
  await saveSessionDraft(store, date, { ...oldDraft, participants: ids })
  expect((await listHistory(store)).map(row => row.id)).toContain(added.id)
  expect(store.doc!.sessions[date].matches).toHaveLength(2)
})
