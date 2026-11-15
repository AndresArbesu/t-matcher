import { afterEach, describe, expect, it, vi } from "vitest"
import { ClientApiError, api } from "@/lib/client-api"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => vi.unstubAllGlobals())

describe("client api", () => {
  it("returns parsed JSON on success and sends JSON bodies with same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { id: "p1", name: "Ana" }))
    vi.stubGlobal("fetch", fetchMock)
    const player = await api.createPlayer({ name: "Ana", skill_level: 3 })
    expect(player).toMatchObject({ id: "p1" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/players")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ name: "Ana", skill_level: 3 })
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  it("throws ClientApiError carrying status and the server's error code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(409, { error: "conflict" })))
    const err = await api.createPlayer({ name: "Ana", skill_level: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(ClientApiError)
    expect(err).toMatchObject({ status: 409, code: "conflict" })
  })

  it("normalises unreadable error bodies and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>boom stack trace</html>", { status: 502 })))
    const err = await api.listPlayers().catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: "server_error" })
    expect(String(err.message)).not.toMatch(/stack|html/)

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    expect(await api.listPlayers().catch((e) => e)).toMatchObject({ status: 0, code: "network" })
  })

  it("targets the documented endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(200, {}))
    vi.stubGlobal("fetch", fetchMock)
    await api.getSession("2026-11-15")
    await api.saveSession("2026-11-15", { participants: [], matches: [] })
    await api.setPlayed("m1", { played: true, notes: "n" })
    await api.deactivatePlayer("p1")
    await api.listHistory()
    expect(fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual([
      "GET /api/sessions/2026-11-15",
      "PUT /api/sessions/2026-11-15",
      "PATCH /api/matches/m1",
      "DELETE /api/players/p1",
      "GET /api/history",
    ])
  })
})
