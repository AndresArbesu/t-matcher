import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryStore } from "./helpers/memory-store"

const { holder } = vi.hoisted(() => ({ holder: { getStore: vi.fn(), store: null as unknown } }))
vi.mock("@/lib/store-instance", () => ({ getStore: () => holder.getStore() }))

import * as exportRoute from "@/app/api/export/route"
import * as historyRoute from "@/app/api/history/route"
import * as loginRoute from "@/app/api/login/route"
import * as logoutRoute from "@/app/api/logout/route"
import * as matchRoute from "@/app/api/matches/[id]/route"
import * as playerRoute from "@/app/api/players/[id]/route"
import * as playersRoute from "@/app/api/players/route"
import * as sessionRoute from "@/app/api/sessions/[date]/route"
import * as whoamiRoute from "@/app/api/session/route"
import { FAILED_LOGIN_DELAY_MS, SESSION_COOKIE, signSession, verifySession } from "@/lib/auth"
import { createPlayer, saveSessionDraft } from "@/lib/repo"

const PASS = "correct horse battery staple"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const cookie = (pass = PASS, expiresAt = Date.now() + 3_600_000) => `${SESSION_COOKIE}=${signSession(pass, expiresAt)}`

interface Init {
  body?: unknown
  cookie?: string | null
  origin?: string
  raw?: string
}
const req = (method: string, init: Init = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const c = init.cookie === undefined ? cookie() : init.cookie
  if (c) headers.cookie = c
  if (init.origin) headers.origin = init.origin
  return new Request("http://localhost/api/x", {
    method,
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  }) as never
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) }) as never

let store: MemoryStore
beforeEach(() => {
  store = new MemoryStore()
  holder.getStore.mockReset().mockImplementation(() => store)
  vi.stubEnv("APP_PASSCODE", PASS)
  vi.stubEnv("VERCEL", "")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const draft = { participants: [1, 2, 3, 4].map(id), matches: [{ team1: [id(1), id(2)], team2: [id(3), id(4)], locked: true }] }

const protectedCalls: [string, (init?: Init) => Promise<Response>][] = [
  ["GET /api/players", (i) => playersRoute.GET(req("GET", i), ctx())],
  ["POST /api/players", (i) => playersRoute.POST(req("POST", { ...i, body: { name: "Ana", skill_level: 3 } }), ctx())],
  ["PATCH /api/players/:id", (i) => playerRoute.PATCH(req("PATCH", { ...i, body: { active: false } }), ctx({ id: id(1) }))],
  ["DELETE /api/players/:id", (i) => playerRoute.DELETE(req("DELETE", i), ctx({ id: id(1) }))],
  ["GET /api/sessions/:date", (i) => sessionRoute.GET(req("GET", i), ctx({ date: "2026-11-15" }))],
  ["PUT /api/sessions/:date", (i) => sessionRoute.PUT(req("PUT", { ...i, body: { participants: [], matches: [] } }), ctx({ date: "2026-11-15" }))],
  ["PATCH /api/matches/:id", (i) => matchRoute.PATCH(req("PATCH", { ...i, body: { played: true } }), ctx({ id: id(1) }))],
  ["GET /api/history", (i) => historyRoute.GET(req("GET", i), ctx())],
  ["GET /api/export", (i) => exportRoute.GET(req("GET", i), ctx())],
  ["GET /api/session", (i) => whoamiRoute.GET(req("GET", i), ctx())],
]

describe("authentication", () => {
  it.each(protectedCalls)("%s returns 401 without a cookie and never touches the store", async (_n, call) => {
    const res = await call({ cookie: null })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
    expect(holder.getStore).not.toHaveBeenCalled()
    expect(store.reads + store.writes).toBe(0)
  })

  it.each(protectedCalls)("%s returns 401 for expired, tampered or wrong-passcode cookies", async (_n, call) => {
    const good = signSession(PASS, Date.now() + 3_600_000)
    const flipped = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0")
    const bad = [cookie(PASS, Date.now() - 1), cookie("another passcode"), `${SESSION_COOKIE}=${flipped}`, `${SESSION_COOKIE}=nonsense`]
    for (const c of bad) {
      expect((await call({ cookie: c })).status).toBe(401)
    }
    expect(holder.getStore).not.toHaveBeenCalled()
  })

  it.each(protectedCalls)("%s fails closed with a generic 500 when APP_PASSCODE is missing on Vercel", async (_n, call) => {
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("APP_PASSCODE", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"server_error"}')
    expect(holder.getStore).not.toHaveBeenCalled()
  })

  it("GET /api/session is { ok: true } with a valid cookie", async () => {
    const res = await whoamiRoute.GET(req("GET"), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("login", () => {
  const login = (passcode: unknown, init: Init = {}) => loginRoute.POST(req("POST", { cookie: null, ...init, body: { passcode } }), ctx())

  it("sets the signed session cookie on the right passcode", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const before = Date.now()
    const res = await login(PASS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const header = res.headers.get("set-cookie")!
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
    expect(header).toMatch(/HttpOnly/i)
    expect(header).toMatch(/SameSite=lax/i)
    expect(header).toMatch(/Path=\//)
    expect(header).toMatch(/Max-Age=15552000/)
    expect(header).not.toMatch(/Secure/i)
    const value = decodeURIComponent(/tm_session=([^;]+)/.exec(header)![1])
    expect(verifySession(value, PASS, Date.now())).toBe(true)
    const expiresAt = Number(value.split(".")[0])
    expect(expiresAt).toBeGreaterThanOrEqual(before + 180 * 86400_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 180 * 86400_000)
  })

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    expect((await login(PASS)).headers.get("set-cookie")).toMatch(/Secure/i)
  })

  it("waits about a second and answers 401 unauthorized on a wrong passcode, without a cookie", async () => {
    vi.useFakeTimers()
    let settled = false
    const pending = login("nope").then((r) => ((settled = true), r))
    await vi.advanceTimersByTimeAsync(FAILED_LOGIN_DELAY_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(FAILED_LOGIN_DELAY_MS).toBe(1000)
  })

  it("rejects malformed bodies with 400 and never sets a cookie", async () => {
    for (const body of [{}, { passcode: 5 }, { passcode: ["a"] }, null]) {
      const res = await loginRoute.POST(req("POST", { cookie: null, body }), ctx())
      expect(res.status).toBe(400)
      expect(res.headers.get("set-cookie")).toBeNull()
    }
    expect((await loginRoute.POST(req("POST", { cookie: null, raw: "{nope" }), ctx())).status).toBe(400)
  })

  it("fails closed with 500 on Vercel without APP_PASSCODE, even for the passcode 'dev'", async () => {
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("APP_PASSCODE", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await login("dev")
    expect(res.status).toBe(500)
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("accepts 'dev' locally when APP_PASSCODE is unset", async () => {
    vi.stubEnv("APP_PASSCODE", "")
    const res = await login("dev")
    expect(res.status).toBe(200)
  })

  it("never touches the store", async () => {
    await login(PASS)
    expect(holder.getStore).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin login", async () => {
    expect((await login(PASS, { origin: "https://evil.example" })).status).toBe(403)
  })
})

describe("logout", () => {
  it("clears the cookie", async () => {
    const res = await logoutRoute.POST(req("POST"), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const header = res.headers.get("set-cookie")!
    expect(header).toMatch(/^tm_session=;/)
    expect(header).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
    expect(header).toMatch(/Path=\//)
  })
  it("works without a session and rejects cross-origin", async () => {
    expect((await logoutRoute.POST(req("POST", { cookie: null }), ctx())).status).toBe(200)
    expect((await logoutRoute.POST(req("POST", { origin: "https://evil.example" }), ctx())).status).toBe(403)
  })
})

describe("CSRF Origin check", () => {
  const changing = protectedCalls.filter(([n]) => /^(POST|PUT|PATCH|DELETE)/.test(n))

  it.each(changing)("%s rejects a foreign Origin with 403 forbidden before touching the store", async (_n, call) => {
    const res = await call({ origin: "https://evil.example" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect(holder.getStore).not.toHaveBeenCalled()
  })

  it("rejects a foreign port, scheme-less 'null' origins and garbage", async () => {
    for (const origin of ["http://localhost:9999", "null", "not a url"]) {
      expect((await playersRoute.POST(req("POST", { origin, body: { name: "Ana", skill_level: 3 } }), ctx())).status).toBe(403)
    }
  })

  it("accepts the same host and an absent Origin", async () => {
    expect((await playersRoute.POST(req("POST", { origin: "http://localhost", body: { name: "Ana", skill_level: 3 } }), ctx())).status).toBe(201)
    expect((await playersRoute.POST(req("POST", { body: { name: "Bo", skill_level: 3 } }), ctx())).status).toBe(201)
  })

  it("compares against the Host header when present (the deployed case)", async () => {
    const mk = (origin: string) =>
      new Request("http://internal/api/players", {
        method: "POST",
        headers: { host: "t-matcher.vercel.app", origin, cookie: cookie(), "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana", skill_level: 3 }),
      }) as never
    expect((await playersRoute.POST(mk("https://t-matcher.vercel.app"), ctx())).status).toBe(201)
    expect((await playersRoute.POST(mk("https://other.vercel.app"), ctx())).status).toBe(403)
  })

  it("does not apply to safe methods", async () => {
    expect((await playersRoute.GET(req("GET", { origin: "https://evil.example" }), ctx())).status).toBe(200)
  })
})

describe("responses", () => {
  it("are Cache-Control: no-store, including errors and the login responses", async () => {
    const responses = [
      await playersRoute.GET(req("GET"), ctx()),
      await playersRoute.GET(req("GET", { cookie: null }), ctx()),
      await playersRoute.POST(req("POST", { body: {} }), ctx()),
      await whoamiRoute.GET(req("GET"), ctx()),
      await loginRoute.POST(req("POST", { cookie: null, body: { passcode: PASS } }), ctx()),
      await logoutRoute.POST(req("POST"), ctx()),
      await exportRoute.GET(req("GET"), ctx()),
    ]
    for (const res of responses) expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("never leak storage error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    store.read = async () => {
      throw new Error("Vercel Blob: token vercel_blob_rw_SECRET denied")
    }
    const res = await playersRoute.GET(req("GET"), ctx())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('{"error":"server_error"}')
  })

  it("answers 409 conflict when the store keeps conflicting", async () => {
    store.failNextWrites(10)
    const res = await playersRoute.POST(req("POST", { body: { name: "Ana", skill_level: 3 } }), ctx())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "conflict" })
  })
})

describe("players", () => {
  it("lists and creates players", async () => {
    expect(await (await playersRoute.GET(req("GET"), ctx())).json()).toEqual([])
    const res = await playersRoute.POST(req("POST", { body: { name: " Bo ", skill_level: 4, owner_id: id(9) } }), ctx())
    expect(res.status).toBe(201)
    const player = await res.json()
    expect(player).toMatchObject({ name: "Bo", skill_level: 4, active: true })
    expect(player).not.toHaveProperty("owner_id")
    expect(await (await playersRoute.GET(req("GET"), ctx())).json()).toEqual([player])
  })

  it("rejects invalid or non-JSON bodies with 400 and a level above 5", async () => {
    expect((await playersRoute.POST(req("POST", { body: { name: "", skill_level: 3 } }), ctx())).status).toBe(400)
    expect((await playersRoute.POST(req("POST", { body: { name: "Ana", skill_level: 6 } }), ctx())).status).toBe(400)
    expect((await playersRoute.POST(req("POST", { body: { name: "Ana", skill_level: 0 } }), ctx())).status).toBe(400)
    expect((await playersRoute.POST(req("POST", { raw: "{nope" }), ctx())).status).toBe(400)
    expect(store.writes).toBe(0)
  })

  it("answers 409 conflict for a duplicate name regardless of case", async () => {
    await playersRoute.POST(req("POST", { body: { name: "Ana", skill_level: 3 } }), ctx())
    const res = await playersRoute.POST(req("POST", { body: { name: "ANA", skill_level: 2 } }), ctx())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "conflict" })
  })

  it("soft-deactivates on DELETE instead of deleting", async () => {
    const ana = await createPlayer(store, { name: "Ana", skill_level: 3 })
    const res = await playerRoute.DELETE(req("DELETE"), ctx({ id: ana.id }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: ana.id, active: false })
    expect(store.doc!.players).toHaveLength(1)
  })

  it("PATCH updates; 404s for unknown players; 400s for malformed ids and empty patches", async () => {
    const ana = await createPlayer(store, { name: "Ana", skill_level: 3 })
    const ok = await playerRoute.PATCH(req("PATCH", { body: { skill_level: 5 } }), ctx({ id: ana.id }))
    expect(await ok.json()).toMatchObject({ skill_level: 5 })
    expect((await playerRoute.PATCH(req("PATCH", { body: { name: "Z" } }), ctx({ id: id(7) }))).status).toBe(404)
    expect((await playerRoute.PATCH(req("PATCH", { body: { name: "Z" } }), ctx({ id: "not-a-uuid" }))).status).toBe(400)
    expect((await playerRoute.PATCH(req("PATCH", { body: {} }), ctx({ id: ana.id }))).status).toBe(400)
    expect((await playerRoute.DELETE(req("DELETE"), ctx({ id: id(7) }))).status).toBe(404)
  })
})

describe("sessions", () => {
  const seed = async () => {
    const ids: string[] = []
    for (let i = 1; i <= 4; i++) ids.push((await createPlayer(store, { name: `P${i}`, skill_level: 3 })).id)
    return {
      participants: ids,
      matches: [{ team1: [ids[0], ids[1]] as [string, string], team2: [ids[2], ids[3]] as [string, string], locked: true }],
    }
  }

  it("GET returns the saved session or null, and 400s on a bad date", async () => {
    expect(await (await sessionRoute.GET(req("GET"), ctx({ date: "2026-11-15" }))).json()).toEqual({ session: null })
    expect((await sessionRoute.GET(req("GET"), ctx({ date: "2026-13-45" }))).status).toBe(400)
  })

  it("PUT saves a draft and returns the stored session", async () => {
    const d = await seed()
    const res = await sessionRoute.PUT(req("PUT", { body: d }), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(200)
    const { session } = await res.json()
    expect(session).toMatchObject({ date: "2026-11-15", participants: d.participants })
    expect(session.matches[0]).toMatchObject({ position: 0, locked: true, played: false, team1: d.matches[0].team1 })
    expect(await (await sessionRoute.GET(req("GET"), ctx({ date: "2026-11-15" }))).json()).toEqual({ session })
  })

  it("PUT rejects unknown players with 422 invalid_players", async () => {
    const res = await sessionRoute.PUT(req("PUT", { body: draft }), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "invalid_players" })
  })

  it("PUT rejects structurally invalid drafts and bad dates before any storage access", async () => {
    const dup = { participants: [id(1), id(1)], matches: [] }
    expect((await sessionRoute.PUT(req("PUT", { body: dup }), ctx({ date: "2026-11-15" }))).status).toBe(400)
    expect((await sessionRoute.PUT(req("PUT", { body: draft }), ctx({ date: "tomorrow" }))).status).toBe(400)
    expect(store.reads).toBe(0)
  })

  it("PUT surfaces removing a participant of a played match as 409 in_use", async () => {
    const d = await seed()
    const saved = await saveSessionDraft(store, "2026-11-15", d)
    await matchRoute.PATCH(req("PATCH", { body: { played: true } }), ctx({ id: saved.matches[0].id }))
    const res = await sessionRoute.PUT(req("PUT", { body: { participants: d.participants.slice(1), matches: [] } }), ctx({ date: "2026-11-15" }))
    expect(res.status).toBe(409)
    expect(await res.text()).toBe('{"error":"in_use"}')
  })
})

describe("matches, history and export", () => {
  it("records a match as played, un-records it, and feeds /api/history", async () => {
    const ids: string[] = []
    for (let i = 1; i <= 4; i++) ids.push((await createPlayer(store, { name: `P${i}`, skill_level: 3 })).id)
    const saved = await saveSessionDraft(store, "2026-11-15", { participants: ids, matches: [{ team1: [ids[0], ids[1]], team2: [ids[2], ids[3]], locked: false }] })
    const matchId = saved.matches[0].id

    const res = await matchRoute.PATCH(req("PATCH", { body: { played: true, notes: " n " } }), ctx({ id: matchId }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: matchId, played: true, notes: "n" })
    const history = await (await historyRoute.GET(req("GET"), ctx())).json()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: matchId, played_at: "2026-11-15", player1_id: ids[0] })

    await matchRoute.PATCH(req("PATCH", { body: { played: false } }), ctx({ id: matchId }))
    expect(await (await historyRoute.GET(req("GET"), ctx())).json()).toEqual([])
  })

  it("404s for unknown matches and 400s for bad input", async () => {
    expect((await matchRoute.PATCH(req("PATCH", { body: { played: true } }), ctx({ id: id(5) }))).status).toBe(404)
    expect((await matchRoute.PATCH(req("PATCH", { body: { played: "y" } }), ctx({ id: id(5) }))).status).toBe(400)
    expect((await matchRoute.PATCH(req("PATCH", { body: { played: true } }), ctx({ id: "x" }))).status).toBe(400)
  })

  it("exports the whole document as a dated JSON download", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T22:00:00Z") })
    await createPlayer(store, { name: "Ana", skill_level: 3 })
    const res = await exportRoute.GET(req("GET"), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="t-matcher-backup-2026-11-15.json"')
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    const doc = JSON.parse(await res.text())
    expect(doc).toMatchObject({ version: 1, players: [{ name: "Ana" }], sessions: {} })
  })

  it("exports an empty document before any data exists", async () => {
    const doc = JSON.parse(await (await exportRoute.GET(req("GET"), ctx())).text())
    expect(doc).toEqual({ version: 1, players: [], sessions: {}, meta: {} })
  })
})
