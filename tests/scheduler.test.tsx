// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MatchHistory, Player, SavedSession } from "@/lib/types"

import Home from "@/app/page"

const players: Player[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  skill_level: (i % 3) + 1,
  active: true,
}))

interface Backend {
  authed: boolean
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

      if (key === "GET /api/session") return backend.authed ? respond(200, { ok: true }) : respond(401, { error: "unauthorized" })
      if (key === "POST /api/login") {
        if (body.passcode !== "dev") return respond(401, { error: "unauthorized" })
        backend.authed = true
        return respond(200, { ok: true })
      }
      if (key === "POST /api/logout") {
        backend.authed = false
        return respond(200, { ok: true })
      }
      if (!backend.authed) return respond(401, { error: "unauthorized" })

      if (key === "GET /api/players") return respond(200, backend.players)
      if (key === "GET /api/history") return respond(200, backend.history)
      if (key === "POST /api/history") {
        const match = { id: "manual", position: 0, played: true, locked: false, notes: null, team1: body.team1, team2: body.team2 }
        backend.history.unshift({ id: match.id, player1_id: body.team1[0], player2_id: body.team1[1], player3_id: body.team2[0], player4_id: body.team2[1], team1_player1_id: body.team1[0], team1_player2_id: body.team1[1], team2_player1_id: body.team2[0], team2_player2_id: body.team2[1], played_at: body.date, created_at: "" })
        const session = backend.session
        if (session && session.date === body.date) {
          session.matches.push(match)
          session.participants = [...new Set([...session.participants, ...body.team1, ...body.team2])]
        }
        backend.fail["GET /api/history"] = { status: 500, error: "server_error" }
        return respond(201, backend.history[0])
      }
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

beforeEach(() => {
  backend = { authed: true, players: players.map((p) => ({ ...p })), session: null, history: [], fail: {}, calls: [] }
  installFetch()
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
  it("shows the passcode form, not the schedule or any data call, when signed out", async () => {
    backend.authed = false
    await openEnglish()
    await screen.findByLabelText("Passcode")
    expect(screen.queryByText(/All Players|Todos los Jugadores/)).toBeNull()
    expect(backend.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/session"])
  })

  it("signs in with the passcode and then loads the roster; a wrong one keeps the form", async () => {
    backend.authed = false
    await openEnglish()
    fireEvent.change(await screen.findByLabelText("Passcode"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByRole("button", { name: "Enter" }))
    await screen.findByText(/That passcode is not right/)
    expect(screen.queryByText(/All Players/)).toBeNull()
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "dev" } })
    fireEvent.click(screen.getByRole("button", { name: "Enter" }))
    await screen.findByText("All Players (8)")
  })

  it("offers the backup download next to Sign out, and signing out hides the app", async () => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    expect(screen.getByRole("link", { name: "Download backup" }).getAttribute("href")).toBe("/api/export")
    fireEvent.click(screen.getByText("Sign out"))
    await screen.findByLabelText("Passcode")
    expect(screen.queryByText(/All Players/)).toBeNull()
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
  const historyRowAt = (played_at: string): MatchHistory => ({ ...historyRow, played_at })
  const openSpanish = async () => {
    await openEnglish()
    fireEvent.click(await screen.findByText("🇪🇸 Español"))
  }
  const helpText = async (open: () => Promise<void>, heading: RegExp) => {
    await open()
    const title = await screen.findByText(heading)
    return title.closest("[data-slot=card]")!.textContent!
  }

  // 3 x (200 + 4 x 25 + 2 x 20) + 100: a rematch of the last session seen once, with nothing else going on
  const RECENT_REMATCH = "1120"

  it("explains scoring with the real DEFAULT_RULES values in English", async () => {
    const text = await helpText(openEnglish, /How the Algorithm Works/)
    for (const n of ["1000", "200", "25", "20", "100", "+50", "×3", "×2", "2000", RECENT_REMATCH]) expect(text).toContain(n)
    expect(text).toMatch(/balance comes first/i)
    expect(text).toMatch(/last session/i)
    expect(text).toMatch(/2 sessions ago/)
    expect(text).toMatch(/more than 1 level/)
    expect(text).toMatch(/never 2 or more/)
    expect(text).toMatch(/at most 2 times/)
    expect(text).toMatch(/up to 2 times/)
    expect(text).toMatch(/never expires/)
    // sessions, not days; and none of the retired numbers or sentences survive
    expect(text).not.toMatch(/\bdays?\b|last week|week's/i)
    expect(text).not.toMatch(/\+500\b|\+1000\b|\+2000\b|\b400 random|\+600|\+300|1-5|1–5/)
  })

  it("explains scoring with the real DEFAULT_RULES values in Spanish", async () => {
    const text = await helpText(openSpanish, /Cómo Funciona el Algoritmo/)
    for (const n of ["1000", "200", "25", "20", "100", "+50", "×3", "×2", "2000", RECENT_REMATCH]) expect(text).toContain(n)
    expect(text).toMatch(/primero, el equilibrio/i)
    expect(text).toMatch(/última sesión/i)
    expect(text).toMatch(/hace 2 sesiones/)
    expect(text).toMatch(/más que 1 nivel/)
    expect(text).toMatch(/nunca 2 o más/)
    expect(text).toMatch(/como máximo 2 veces/)
    expect(text).toMatch(/hasta 2 veces/)
    expect(text).toMatch(/nunca caduca/)
    expect(text).not.toMatch(/\bdías?\b|semana pasada|de la semana/i)
    expect(text).not.toMatch(/\+500\b|\+1000\b|\+2000\b|\b400 programaciones|\+600|\+300|1-5|1–5/)
  })

  it("offers skill levels 1 to 3 only (1 is the strongest), and adds the chosen level", async () => {
    await openEnglish()
    const group = await screen.findByRole("radiogroup", { name: "Skill Level (1-3)" })
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((r) => r.textContent)).toEqual(["1", "2", "3"])
    expect(radios.find((r) => r.getAttribute("aria-checked") === "true")?.textContent).toBe("2")
    expect(screen.getByText("1 is the strongest, 3 the lowest.")).toBeTruthy()
    expect(screen.queryByText(/1-5|1–5|1-10/)).toBeNull()
    for (const r of radios) expect(r.className).toContain("min-h-11")
    fireEvent.click(radios[2])
    fireEvent.change(screen.getByLabelText("Player Name"), { target: { value: "Newbie" } })
    fireEvent.click(screen.getByText("Add Player"))
    await screen.findByText("All Players (9)")
    expect(backend.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Newbie", skill_level: 3 })
    // the form resets to the default level
    expect(within(screen.getByRole("radiogroup", { name: "Skill Level (1-3)" })).getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent).toBe("2")
  })

  it("labels and explains the skill levels in Spanish", async () => {
    await openEnglish()
    fireEvent.click(await screen.findByText("🇪🇸 Español"))
    const group = await screen.findByRole("radiogroup", { name: "Nivel de Habilidad (1-3)" })
    expect(within(group).getAllByRole("radio")).toHaveLength(3)
    expect(screen.getByText("1 es el mejor nivel, 3 el más bajo.")).toBeTruthy()
    expect(screen.queryByText(/1-5|1–5/)).toBeNull()
  })

  const fourOf = (played_at: string): MatchHistory => ({ ...historyRowAt(played_at), team1_player1_id: "p1", team1_player2_id: "p2", team2_player1_id: "p3", team2_player2_id: "p4" })
  const otherGame = (played_at: string): MatchHistory => ({
    ...historyRowAt(played_at),
    id: `o-${played_at}`,
    player1_id: "p5", player2_id: "p6", player3_id: "p7", player4_id: "p8",
    team1_player1_id: "p5", team1_player2_id: "p6", team2_player1_id: "p7", team2_player2_id: "p8",
  })
  const generateFor = async (sessionDate: string) => {
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: sessionDate } })
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getAllByRole("checkbox")[i])
    fireEvent.click(screen.getByText("Generate Suggestions"))
  }

  it("measures repeats against the session date on screen: the latest earlier session is the last session", async () => {
    backend.history = [fourOf("2026-03-08")]
    await generateFor("2026-03-15")
    expect((await screen.findAllByText(/Last repeat: last session/)).length).toBeGreaterThan(0)
  })

  it("counts sessions, not days: a session 40 days earlier is still the last session", async () => {
    backend.history = [fourOf("2026-02-03")]
    await generateFor("2026-03-15")
    expect((await screen.findAllByText(/Last repeat: last session/)).length).toBeGreaterThan(0)
  })

  it("says how many sessions ago a repeat was", async () => {
    backend.history = [fourOf("2026-03-01"), otherGame("2026-03-08")]
    await generateFor("2026-03-15")
    expect((await screen.findAllByText(/Last repeat: 2 sessions ago/)).length).toBeGreaterThan(0)
  })

  it("hydrates a saved draft with repeats measured against its own date", async () => {
    backend.history = [fourOf("2026-03-08")]
    backend.session = {
      date: "2026-03-15",
      participants: ["p1", "p2", "p3", "p4"],
      matches: [{ id: "m1", position: 0, team1: ["p1", "p2"], team2: ["p3", "p4"], locked: false, played: false, notes: null }],
    }
    await openEnglish()
    await screen.findByText("All Players (8)")
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: "2026-03-15" } })
    expect((await screen.findAllByText(/Last repeat: last session/)).length).toBeGreaterThan(0)
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


it("shows a successfully saved historical match even if a later history refresh fails", async () => {
  await openEnglish()
  await screen.findByText("All Players (8)")
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
  fireEvent.change(screen.getByLabelText("Match date"), { target: { value: "2020-01-02" } })
  for (let n = 1; n <= 4; n++) fireEvent.change(screen.getByLabelText(`Player ${n}`), { target: { value: `p${n}` } })
  fireEvent.click(screen.getByRole("button", { name: "Add historical match" }))
  expect(await screen.findByText("Historical match added.")).toBeTruthy()
  expect(await screen.findByText(/Match on Jan 2, 2020/)).toBeTruthy()
})


it("keeps unsaved locked drafts and updates the current session after adding history on that date", async () => {
  await openEnglish()
  await screen.findByText("All Players (8)")
  const date = (screen.getByLabelText("Session date") as HTMLInputElement).value
  backend.session = { date, participants: [], matches: [] }
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getAllByRole("checkbox")[i])
  fireEvent.click(screen.getByText("Generate Suggestions"))
  fireEvent.click((await screen.findAllByLabelText("Lock match 1"))[0])
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
  fireEvent.change(screen.getByLabelText("Match date"), { target: { value: date } })
  for (let n = 1; n <= 4; n++) fireEvent.change(screen.getByLabelText(`Player ${n}`), { target: { value: `p${n + 4}` } })
  fireEvent.click(screen.getByRole("button", { name: "Add historical match" }))
  await screen.findByText("Historical match added.")
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Record Match" }))
  expect(await screen.findByText("1 of 1 played")).toBeTruthy()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Players & Suggestions" }))
  expect(screen.getByText(/\(8 selected\)/)).toBeTruthy()
  expect((screen.getAllByLabelText("Lock match 1")[0] as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getAllByText("Save Schedule")[0])
  await screen.findByText("Schedule saved")
  expect(putBody().participants).toHaveLength(8)
})

it("rescores existing locked suggestions when an earlier historical match is added", async () => {
  await openEnglish()
  await screen.findByText("All Players (8)")
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getAllByRole("checkbox")[i])
  fireEvent.click(screen.getByText("Generate Suggestions"))
  fireEvent.click((await screen.findAllByLabelText("Lock match 1"))[0])
  expect(screen.getAllByText(/Last repeat: never/i).length).toBeGreaterThan(0)
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Match History" }))
  fireEvent.change(screen.getByLabelText("Match date"), { target: { value: "2020-01-02" } })
  for (let n = 1; n <= 4; n++) fireEvent.change(screen.getByLabelText(`Player ${n}`), { target: { value: `p${n}` } })
  fireEvent.click(screen.getByRole("button", { name: "Add historical match" }))
  await screen.findByText("Historical match added.")
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Players & Suggestions" }))
  expect(screen.getAllByText(/Last repeat: last session/).length).toBeGreaterThan(0)
  expect((screen.getAllByLabelText("Lock match 1")[0] as HTMLInputElement).checked).toBe(true)
})
