import { beforeEach, describe, expect, it, vi } from "vitest"

const { getUser, createClient, repo } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  repo: {
    listPlayers: vi.fn(),
    createPlayer: vi.fn(),
    updatePlayer: vi.fn(),
    countOwnedPlayers: vi.fn(),
    getSession: vi.fn(),
    saveSessionDraft: vi.fn(),
    setMatchPlayed: vi.fn(),
    listHistory: vi.fn(),
  },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }))
vi.mock("@/lib/repo", () => repo)

import * as historyRoute from "@/app/api/history/route"
import * as matchRoute from "@/app/api/matches/[id]/route"
import * as playerRoute from "@/app/api/players/[id]/route"
import * as playersRoute from "@/app/api/players/route"
import * as sessionRoute from "@/app/api/sessions/[date]/route"

const U = "11111111-1111-4111-8111-111111111111"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  const supabase = { auth: { getUser } }
  createClient.mockResolvedValue(supabase)
  getUser.mockResolvedValue({ data: { user: { id: U } }, error: null })
})

const calls: [string, () => Promise<Response>][] = [
  ["GET /api/players", () => playersRoute.GET(req("GET"), ctx({}))],
  ["POST /api/players", () => playersRoute.POST(req("POST", { name: "Ana", skill_level: 3 }), ctx({}))],
  ["PATCH /api/players/:id", () => playerRoute.PATCH(req("PATCH", { active: false }), ctx({ id: id(1) }))],
  ["DELETE /api/players/:id", () => playerRoute.DELETE(req("DELETE"), ctx({ id: id(1) }))],
  ["GET /api/sessions/:date", () => sessionRoute.GET(req("GET"), ctx({ date: "2026-11-15" }))],
  ["PUT /api/sessions/:date", () => sessionRoute.PUT(req("PUT", { participants: [], matches: [] }), ctx({ date: "2026-11-15" }))],
  ["PATCH /api/matches/:id", () => matchRoute.PATCH(req("PATCH", { played: true }), ctx({ id: id(1) }))],
  ["GET /api/history", () => historyRoute.GET(req("GET"), ctx({}))],
]

describe("authentication", () => {
  it.each(calls)("%s returns 401 without a user and never touches data", async (_n, call) => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled()
  })

  it.each(calls)("%s returns 401 when auth lookup errors", async (_n, call) => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt expired secret" } })
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.text()).not.toMatch(/jwt|secret/)
  })

  it("returns a generic 500 when the Supabase client cannot be created", async () => {
    createClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"))
    const res = await playersRoute.GET(req("GET"), ctx({}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "server_error" })
  })
})

describe("provider errors", () => {
  it("never leaks provider error text", async () => {
    repo.listPlayers.mockRejectedValue({ code: "XX000", message: 'permission denied for table players; key sb_secret_123' })
    const res = await playersRoute.GET(req("GET"), ctx({}))
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"server_error"}')
  })
  it("maps duplicate player names to 409", async () => {
    repo.createPlayer.mockRejectedValue({ code: "23505", message: "duplicate key value violates players_owner_name_key" })
    const res = await playersRoute.POST(req("POST", { name: "Ana", skill_level: 3 }), ctx({}))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "conflict" })
  })
})

describe("players", () => {
  it("lists and creates players", async () => {
    repo.listPlayers.mockResolvedValue([{ id: id(1), name: "Ana", skill_level: 3, active: true }])
    expect(await (await playersRoute.GET(req("GET"), ctx({}))).json()).toHaveLength(1)
    repo.createPlayer.mockResolvedValue({ id: id(2), name: "Bo", skill_level: 4, active: true })
    const res = await playersRoute.POST(req("POST", { name: " Bo ", skill_level: 4, owner_id: id(9) }), ctx({}))
    expect(res.status).toBe(201)
    expect(repo.createPlayer).toHaveBeenCalledWith(expect.anything(), { name: "Bo", skill_level: 4 })
  })
  it("rejects invalid or non-JSON bodies with 400", async () => {
    expect((await playersRoute.POST(req("POST", { name: "", skill_level: 3 }), ctx({}))).status).toBe(400)
    const bad = new Request("http://localhost/api/players", { method: "POST", body: "{nope" }) as never
    expect((await playersRoute.POST(bad, ctx({}))).status).toBe(400)
    expect(repo.createPlayer).not.toHaveBeenCalled()
  })
  it("soft-deactivates on DELETE instead of deleting", async () => {
    repo.updatePlayer.mockResolvedValue({ id: id(1), active: false })
    const res = await playerRoute.DELETE(req("DELETE"), ctx({ id: id(1) }))
    expect(res.status).toBe(200)
    expect(repo.updatePlayer).toHaveBeenCalledWith(expect.anything(), id(1), { active: false })
  })
  it("404s for players the user does not own and 400s for malformed ids", async () => {
    repo.updatePlayer.mockResolvedValue(null)
    expect((await playerRoute.PATCH(req("PATCH", { name: "Z" }), ctx({ id: id(7) }))).status).toBe(404)
    expect((await playerRoute.PATCH(req("PATCH", { name: "Z" }), ctx({ id: "not-a-uuid" }))).status).toBe(400)
    expect((await playerRoute.PATCH(req("PATCH", {}), ctx({ id: id(7) }))).status).toBe(400)
  })
})

describe("sessions", () => {
  const draft = { participants: [1, 2, 3, 4].map(id), matches: [{ team1: [id(1), id(2)], team2: [id(3), id(4)], locked: true }] }

  it("GET returns the saved session or null", async () => {
    repo.getSession.mockResolvedValue(null)
    expect(await (await sessionRoute.GET(req("GET"), ctx({ date: "2026-11-15" }))).json()).toEqual({ session: null })
    expect((await sessionRoute.GET(req("GET"), ctx({ date: "2026-13-45" }))).status).toBe(400)
  })

  it("PUT saves a draft whose player IDs are all owned by the user", async () => {
    repo.countOwnedPlayers.mockResolvedValue(4)
    repo.saveSessionDraft.mockResolvedValue(undefined)
    repo.getSession.mockResolvedValue({ date: "2026-11-15", participants: draft.participants, matches: [] })
    const res = await sessionRoute.PUT(req("PUT", draft), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(200)
    expect(repo.countOwnedPlayers).toHaveBeenCalledWith(expect.anything(), draft.participants)
    expect(repo.saveSessionDraft).toHaveBeenCalledWith(expect.anything(), "2026-11-15", draft)
  })

  it("PUT rejects player IDs the user does not own (or that do not exist) with 422", async () => {
    repo.countOwnedPlayers.mockResolvedValue(3)
    const res = await sessionRoute.PUT(req("PUT", draft), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "invalid_players" })
    expect(repo.saveSessionDraft).not.toHaveBeenCalled()
  })

  it("PUT rejects structurally invalid drafts and bad dates before any database call", async () => {
    const dup = { participants: [id(1), id(1)], matches: [] }
    expect((await sessionRoute.PUT(req("PUT", dup), ctx({ date: "2026-11-15" }))).status).toBe(400)
    expect((await sessionRoute.PUT(req("PUT", draft), ctx({ date: "tomorrow" }))).status).toBe(400)
    expect(repo.countOwnedPlayers).not.toHaveBeenCalled()
    expect(repo.saveSessionDraft).not.toHaveBeenCalled()
  })

  it("PUT surfaces a played-match conflict as 409 without provider text", async () => {
    repo.countOwnedPlayers.mockResolvedValue(4)
    repo.saveSessionDraft.mockRejectedValue({ code: "23503", message: "violates foreign key session_matches_..." })
    const res = await sessionRoute.PUT(req("PUT", draft), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(409)
    expect(await res.text()).toBe('{"error":"in_use"}')
  })
})

describe("matches and history", () => {
  it("records a match as played and un-records it", async () => {
    repo.setMatchPlayed.mockResolvedValue({ id: id(1), played: true })
    const res = await matchRoute.PATCH(req("PATCH", { played: true, notes: " n " }), ctx({ id: id(1) }))
    expect(res.status).toBe(200)
    expect(repo.setMatchPlayed).toHaveBeenCalledWith(expect.anything(), id(1), { played: true, notes: "n" })
  })
  it("404s for another owner's match and 400s for bad input", async () => {
    repo.setMatchPlayed.mockResolvedValue(null)
    expect((await matchRoute.PATCH(req("PATCH", { played: true }), ctx({ id: id(5) }))).status).toBe(404)
    expect((await matchRoute.PATCH(req("PATCH", { played: "y" }), ctx({ id: id(5) }))).status).toBe(400)
    expect((await matchRoute.PATCH(req("PATCH", { played: true }), ctx({ id: "x" }))).status).toBe(400)
  })
  it("returns played-match history in the analyzer shape", async () => {
    repo.listHistory.mockResolvedValue([{ id: id(1) }])
    expect(await (await historyRoute.GET(req("GET"), ctx({}))).json()).toEqual([{ id: id(1) }])
  })
})
