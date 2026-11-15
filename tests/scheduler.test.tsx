// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchHistory, Player, SavedSession } from "@/lib/types"

const { authMock } = vi.hoisted(() => ({ authMock: { current: null as unknown } }))
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    if (!authMock.current) throw new Error("Missing env")
    return { auth: authMock.current }
  },
}))

import Home from "@/app/page"

const players: Player[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  skill_level: (i % 5) + 1,
  active: true,
}))

interface Backend {
  players: Player[]
  session: SavedSession | null
  history: MatchHistory[]
  fail: Record<string, { status: number; error: string }>
  calls: { method: string; url: string; body: any }[]
}

let backend: Backend

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      backend.calls.push({ method, url, body })
      const key = `${method} ${url.replace(/\d{4}-\d{2}-\d{2}/, ":date")}`
      const respond = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
      if (backend.fail[key]) return respond(backend.fail[key].status, { error: backend.fail[key].error })

      if (key === "GET /api/players") return respond(200, backend.players)
      if (key === "GET /api/history") return respond(200, backend.history)
      if (key === "GET /api/sessions/:date") return respond(200, { session: backend.session })
      if (key.startsWith("DELETE /api/players/")) {
        const p = backend.players.find((x) => x.id === url.split("/").pop())!
        p.active = false
        return respond(200, p)
      }
      if (key === "POST /api/players") {
        const p = { id: `p${backend.players.length + 1}`, active: true, ...body }
        backend.players.push(p)
        return respond(201, p)
      }
      if (key === "PUT /api/sessions/:date") {
        backend.session = {
          date: url.split("/").pop()!,
          participants: body.participants,
          matches: body.matches.map((m: any, i: number) => ({ id: `m${i + 1}`, position: i, played: false, notes: null, ...m })),
        }
        return respond(200, { session: backend.session })
      }
      if (key.startsWith("PATCH /api/matches/")) {
        const m = backend.session!.matches.find((x) => x.id === url.split("/").pop())!
        m.played = body.played
        m.notes = body.notes ?? null
        backend.history = body.played
          ? [{ id: m.id, player1_id: m.team1[0], player2_id: m.team1[1], player3_id: m.team2[0], player4_id: m.team2[1], team1_player1_id: m.team1[0], team1_player2_id: m.team1[1], team2_player1_id: m.team2[0], team2_player2_id: m.team2[1], played_at: "2026-11-15", created_at: "" }]
          : []
        return respond(200, m)
      }
      return respond(404, { error: "not_found" })
    }),
  )
}

function signedIn(signedIn = true) {
  authMock.current = {
    getSession: async () => ({ data: { session: signedIn ? { user: { email: "me@example.com" } } : null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithOtp: async () => ({ error: null }),
    verifyOtp: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
  }
}

beforeEach(() => {
  backend = { players: players.map((p) => ({ ...p })), session: null, history: [], fail: {}, calls: [] }
  installFetch()
  signedIn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it("stacks navigation and header controls on narrow screens", async () => {
  render(<Home />)
  const tabs = await screen.findByRole("tablist")
  // three short tabs share one row even at 320px instead of stacking into three tall rows
  expect(tabs.className).toContain("grid-cols-3")
  expect(tabs.className).not.toContain("grid-cols-1")
  const heading = screen.getByRole("heading", { level: 1 })
  expect(heading.parentElement?.className).toContain("flex-col")
  expect(heading.parentElement?.className).toContain("sm:flex-row")
  // the add-player form is a single column on phones, with a full-width submit
  const form = screen.getByLabelText(/Nombre del Jugador/).closest("form")!
  expect(form.className).toContain("grid-cols-1")
  expect(form.className).toContain("sm:flex")
  expect(within(form).getByRole("button", { name: "Agregar Jugador" }).className).toContain("w-full")
})

async function openEnglish() {
  render(<Home />)
  fireEvent.click(await screen.findByText("🇺🇸 English"))
}

const putBody = () => backend.calls.filter((c) => c.method === "PUT").at(-1)?.body

describe("authentication states", () => {
  it("shows sign-in, not the schedule or any API call, when signed out", async () => {
    signedIn(false)
    await openEnglish()
    await screen.findByLabelText("Email")
    expect(screen.queryByText(/All Players|Todos los Jugadores/)).toBeNull()
    expect(backend.calls).toHaveLength(0)
  })

  it("shows an explicit configuration error when Supabase env is missing", async () => {
    authMock.current = null
    render(<Home />)
    await screen.findByText(/not configured|no está configurado/i)
  })
})

describe("roster", () => {
  it("shows a loading state, then the persisted roster", async () => {
    await openEnglish()
    expect(await screen.findAllByText(/Player 1 \(/)).not.toHaveLength(0)
    expect(screen.getByText("All Players (8)")).toBeTruthy()
  })

  it("shows a visible error with retry when the roster cannot be loaded", async () => {
    backend.fail["GET /api/players"] = { status: 500, error: "server_error" }
    await openEnglish()
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/something went wrong/i)
    delete backend.fail["GET /api/players"]
    fireEvent.click(screen.getByText("Retry"))
    await screen.findByText("All Players (8)")
  })

  it("explains a duplicate player name instead of failing silently", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    backend.fail["POST /api/players"] = { status: 409, error: "conflict" }
    fireEvent.change(screen.getByLabelText("Player Name"), { target: { value: "Player 1" } })
    fireEvent.click(screen.getByText("Add Player"))
    expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/i)
  })

  it("deactivates a player (keeping history) and removes them from the roster", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    const row = screen.getAllByText(/^Player 8 \(/)[0].closest("div.flex")!
    fireEvent.click(within(row as HTMLElement).getByText("Remove"))
    await screen.findByText("All Players (7)")
    expect(backend.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/players/p8"])
    expect(screen.queryByText(/^Player 8 \(/)).toBeNull()
  })
})

describe("persistent session draft", () => {
  async function generateWithLock() {
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.click(screen.getByText("Select All"))
    fireEvent.click(screen.getByText("Generate Suggestions"))
    const locks = await screen.findAllByLabelText("Lock match 1")
    fireEvent.click(locks[0])
    return locks
  }

  it("selects participants, generates, locks, regenerates and saves with positions and locks", async () => {
    await generateWithLock()
    const first = screen.getAllByText(/^Match 1$/)[0].closest("div.p-3")!
    const lockedBefore = within(first as HTMLElement).getAllByText(/Player \d/).map((n) => n.textContent)

    fireEvent.click(screen.getAllByText("Regenerate with Fixed Matches")[0])
    const lockedAfter = within(screen.getAllByText(/^Match 1$/)[0].closest("div.p-3") as HTMLElement)
      .getAllByText(/Player \d/)
      .map((n) => n.textContent)
    expect(lockedAfter).toEqual(lockedBefore)

    fireEvent.click(screen.getAllByText("Save Schedule")[0])
    await screen.findByText("Schedule saved")

    const body = putBody()
    expect(body.participants.slice().sort()).toEqual(players.map((p) => p.id).sort())
    expect(body.matches).toHaveLength(2)
    expect(body.matches[0].locked).toBe(true)
    expect(body.matches[1].locked).toBe(false)
    expect(backend.calls.find((c) => c.method === "PUT")!.url).toMatch(/^\/api\/sessions\/\d{4}-\d{2}-\d{2}$/)
  })

  it("keeps the draft on screen and reports an error when saving fails", async () => {
    await generateWithLock()
    backend.fail["PUT /api/sessions/:date"] = { status: 500, error: "server_error" }
    fireEvent.click(screen.getAllByText("Save Schedule")[0])
    expect((await screen.findByRole("alert")).textContent).toMatch(/something went wrong/i)
    expect(screen.getAllByText("Save Schedule").length).toBeGreaterThan(0)
    expect(screen.queryByText("Schedule saved")).toBeNull()
  })

  it("reloads a saved session: selected participants, matches and lock states", async () => {
    backend.session = {
      date: "2026-11-15",
      participants: players.map((p) => p.id),
      matches: [
        { id: "m1", position: 0, team1: ["p1", "p2"], team2: ["p3", "p4"], locked: true, played: false, notes: null },
        { id: "m2", position: 1, team1: ["p5", "p6"], team2: ["p7", "p8"], locked: false, played: false, notes: null },
      ],
    }
    await openEnglish()
    await screen.findByText(/\(8 selected\)/)
    expect(await screen.findByText("FIXED")).toBeTruthy()
    expect((screen.getByLabelText("Lock match 1") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Lock match 2") as HTMLInputElement).checked).toBe(false)
  })

  it("saves a participants-only selection", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.click(screen.getByText("Select All"))
    fireEvent.click(screen.getByText("Save Selection"))
    await screen.findByText("Selection saved")
    expect(putBody().matches).toEqual([])
    expect(putBody().participants).toHaveLength(8)
  })

  it("reports a failed session load instead of showing an empty draft", async () => {
    backend.fail["GET /api/sessions/:date"] = { status: 500, error: "server_error" }
    await openEnglish()
    expect((await screen.findByRole("alert")).textContent).toMatch(/something went wrong/i)
  })
})

describe("recording played matches", () => {
  const saved: SavedSession = {
    date: "2026-11-15",
    participants: players.map((p) => p.id),
    matches: [{ id: "m1", position: 0, team1: ["p1", "p2"], team2: ["p3", "p4"], locked: false, played: false, notes: null }],
  }

  it("marks a saved match played and feeds it into the historical count and history tab", async () => {
    backend.session = structuredClone(saved)
    await openEnglish()
    await screen.findByText(/Based on 0 historical matches/)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record Match" }))
    fireEvent.change(await screen.findByLabelText("Notes (Optional)"), { target: { value: "tight" } })
    fireEvent.click(screen.getByText("Mark as played"))
    await waitFor(() => expect(backend.calls.some((c) => c.method === "PATCH" && c.body.played === true && c.body.notes === "tight")).toBe(true))
    await screen.findByText("Played")
    expect(screen.getByText("1 of 1 played")).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
    await screen.findByText(/Match History \(1 match\)/)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Players & Suggestions" }))
    await screen.findByText(/Based on 1 historical match$/)
  })

  it("tells the user to save a schedule first when nothing is saved", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record Match" }))
    await screen.findByText(/save a schedule/i)
  })

  it("shows an error if recording fails", async () => {
    backend.session = structuredClone(saved)
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record Match" }))
    backend.fail["PATCH /api/matches/m1"] = { status: 500, error: "server_error" }
    fireEvent.click(await screen.findByText("Mark as played"))
    expect((await screen.findByRole("alert")).textContent).toMatch(/something went wrong/i)
  })
})

describe("browser-found corrections", () => {
  const historyRow: MatchHistory = {
    id: "m1", player1_id: "p1", player2_id: "p2", player3_id: "p3", player4_id: "p4",
    team1_player1_id: "p1", team1_player2_id: "p2", team2_player1_id: "p3", team2_player2_id: "p4",
    played_at: "2026-11-15", created_at: "",
  }
  const openSpanish = async () => {
    await openEnglish()
    fireEvent.click(await screen.findByText("🇪🇸 Español"))
  }
  const helpText = async (open: () => Promise<void>, heading: RegExp) => {
    await open()
    const title = await screen.findByText(heading)
    return title.closest("[data-slot=card]")!.textContent!
  }

  it("explains scoring with the real DEFAULT_RULES values in English", async () => {
    const text = await helpText(openEnglish, /How the Algorithm Works/)
    for (const n of ["1000", "500", "300", "2000", "10", "×3", "400"]) expect(text).toContain(n)
    expect(text).not.toMatch(/\+200\b|\+100\b|\+50\b|Score 2\b/)
  })

  it("explains scoring with the real DEFAULT_RULES values in Spanish", async () => {
    const text = await helpText(openSpanish, /Cómo Funciona el Algoritmo/)
    for (const n of ["1000", "500", "300", "2000", "10", "×3", "400"]) expect(text).toContain(n)
    expect(text).not.toMatch(/\+200\b|\+100\b|\+50\b|Puntuación 2\b/)
  })

  it("offers skill levels 1 to 5 only, and adds the chosen level", async () => {
    await openEnglish()
    const group = await screen.findByRole("radiogroup", { name: "Skill Level (1-5)" })
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "5"])
    expect(radios.find((r) => r.getAttribute("aria-checked") === "true")?.textContent).toBe("3")
    expect(screen.queryByText(/1-10/)).toBeNull()
    for (const r of radios) expect(r.className).toContain("min-h-11")
    fireEvent.click(radios[4])
    fireEvent.change(screen.getByLabelText("Player Name"), { target: { value: "Newbie" } })
    fireEvent.click(screen.getByText("Add Player"))
    await screen.findByText("All Players (9)")
    expect(backend.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Newbie", skill_level: 5 })
  })

  it("adds a player with Enter and resets the form", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    const name = screen.getByLabelText("Player Name") as HTMLInputElement
    fireEvent.change(name, { target: { value: "Kim" } })
    fireEvent.submit(name.closest("form")!)
    await screen.findByText("All Players (9)")
    expect(name.value).toBe("")
  })

  it("says what is missing once, not in the header, the body and a hint", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    expect(screen.getAllByText(/at least 4 players/i)).toHaveLength(1)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getAllByRole("checkbox")[i])
    expect(screen.getAllByText(/multiple of 4/i)).toHaveLength(1)
  })

  it("shows the lock hint only once there is a schedule, and keeps the long scoring text collapsed", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    expect(screen.queryByText(/Tick a match to lock it/)).toBeNull()
    fireEvent.click(screen.getByText("Select All"))
    fireEvent.click(screen.getByText("Generate Suggestions"))
    await screen.findAllByText(/Tick a match to lock it/)
    expect(screen.getAllByText(/Tick a match to lock it/)).toHaveLength(1)
    const details = screen.getByText(/How the Algorithm Works/).closest("details")!
    expect(details.open).toBe(false)
  })

  it("ranks the offered schedules and lays out each match for a 320px screen", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.click(screen.getByText("Select All"))
    const generate = screen.getByText("Generate Suggestions")
    expect(generate.className).toContain("w-full")
    fireEvent.click(generate)
    await screen.findAllByLabelText("Lock match 1")
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "")
    expect(headings.some((h) => h.startsWith("#1 "))).toBe(true)
    const header = screen.getAllByText(/^Match 1$/)[0].closest("div.p-3")!.firstElementChild as HTMLElement
    expect(header.className).toContain("flex-wrap")
    const lock = screen.getAllByLabelText("Lock match 1")[0] as HTMLInputElement
    expect(lock.className).toContain("w-5")
    expect(lock.closest("label")!.className).toContain("min-h-11")
    const save = screen.getAllByText("Save Schedule")[0]
    expect(save.className).toContain("w-full")
    expect(save.className).toContain("sm:w-auto")
  })

  it("makes attendance rows full-width touch targets", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    const box = screen.getAllByRole("checkbox")[0]
    expect(box.closest("label")!.className).toContain("min-h-12")
    expect((screen.getByLabelText("Session date") as HTMLInputElement).className).toContain("w-full")
  })

  it("localizes the history tab and shows a date-only session date exactly, in any timezone", async () => {
    const original = process.env.TZ
    process.env.TZ = "America/Argentina/Buenos_Aires"
    try {
      backend.history = [historyRow]
      await openSpanish()
      await screen.findByText("Todos los Jugadores (8)")
      await screen.findByText("Basado en 1 partido histórico")
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Historial de Partidos" }))
      const card = (await screen.findByText(/Historial de Partidos \(1/)).closest("[data-slot=card]")!
      const text = card.textContent!
      expect(text).toContain("Historial de Partidos (1 partido)")
      expect(screen.getByRole("button", { name: "Eliminar" }).parentElement?.parentElement?.className).toContain("flex-col")
      expect(text).toMatch(/15 nov/i)
      expect(text).not.toMatch(/14 nov/i)
      expect(text).not.toMatch(/Match on|Skill Difference|Remove|Search|Most Recent|Team 1/)
      expect(text).toContain("Equipo 1")
    } finally {
      process.env.TZ = original
    }
  })

  it("shows the English history date as Nov 15 for 2026-11-15", async () => {
    backend.history = [historyRow]
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
    expect((await screen.findByText(/Match on/)).textContent).toMatch(/Nov 15, 2026$/)
  })

  it("styles inactive tabs and the history card readably in dark mode", async () => {
    backend.history = [historyRow]
    await openEnglish()
    await screen.findByText("All Players (8)")
    expect(screen.getByRole("tab", { name: "Record Match" }).className).toMatch(/(^|\s)text-slate-(200|300)/)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
    const card = (await screen.findByText(/Match History \(1/)).closest("[data-slot=card]")!
    expect(card.className).toMatch(/bg-slate-800/)
    expect(card.className).toMatch(/text-slate-100/)
  })

  it("clears a stale error once a session loads successfully", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    backend.fail["GET /api/sessions/:date"] = { status: 500, error: "server_error" }
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: "2026-11-01" } })
    await screen.findByRole("alert")
    delete backend.fail["GET /api/sessions/:date"]
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: "2026-11-16" } })
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
})
