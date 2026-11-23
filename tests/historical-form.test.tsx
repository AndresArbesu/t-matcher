// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import * as historyDisplay from "@/components/match-history-display"
import { translations } from "@/lib/translations"

const players = [1,2,3,4].map(n => ({ id: `p${n}`, name: `Player ${n}`, active: n !== 4, skill_level: 2 }))
afterEach(cleanup)
it("keeps visible spacing between each label and its control", () => {
  render(<historyDisplay.HistoricalMatchForm players={players} t={translations.en} onSave={vi.fn()} />)
  for (const name of ["Match date", "Player 1", "Player 2", "Player 3", "Player 4"]) {
    expect(screen.getByLabelText(name).parentElement?.className).toContain("gap-2")
  }
})
it("submits a past date and two teams, including inactive roster players", async () => {
  const save = vi.fn().mockResolvedValue(true)
  expect(historyDisplay).toHaveProperty("HistoricalMatchForm")
  const HistoricalMatchForm = (historyDisplay as any).HistoricalMatchForm
  render(<HistoricalMatchForm players={players} t={translations.en} onSave={save} />)
  fireEvent.change(screen.getByLabelText("Match date"), { target: { value: "2020-01-02" } })
  for (let n = 1; n <= 4; n++) fireEvent.change(screen.getByLabelText(`Player ${n}`), { target: { value: `p${n}` } })
  fireEvent.click(screen.getByRole("button", { name: "Add historical match" }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ date: "2020-01-02", team1: ["p1", "p2"], team2: ["p3", "p4"] }))
})

it("rejects repeated players before sending", async () => {
  const save = vi.fn().mockResolvedValue(true)
  const HistoricalMatchForm = (historyDisplay as any).HistoricalMatchForm
  render(<HistoricalMatchForm players={players} t={translations.es} onSave={save} />)
  fireEvent.change(screen.getByLabelText("Fecha del partido"), { target: { value: "2020-01-02" } })
  for (let n = 1; n <= 4; n++) fireEvent.change(screen.getByLabelText(`Jugador ${n}`), { target: { value: `p${Math.min(n, 3)}` } })
  fireEvent.click(screen.getByRole("button", { name: "Agregar partido histórico" }))
  expect(screen.getByRole("alert").textContent).toContain("cuatro jugadores diferentes")
  expect(save).not.toHaveBeenCalled()
})

it("uses the organizer local date for the date limit", () => {
  const oldTZ = process.env.TZ
  process.env.TZ = "Pacific/Kiritimati"
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-03-01T12:30:00Z"))
  try {
    render(<historyDisplay.HistoricalMatchForm players={players} t={translations.en} onSave={vi.fn()} />)
    expect((screen.getByLabelText("Match date") as HTMLInputElement).max).toBe("2026-03-02")
  } finally {
    vi.useRealTimers()
    process.env.TZ = oldTZ
  }
})
