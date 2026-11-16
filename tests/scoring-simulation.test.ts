import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SAMPLING, MatchAnalyzer, canonicalMatchKey } from "@/lib/match-analyzer"
import type { MatchHistory, Player } from "@/lib/types"

const roster = (skills: number[]): Player[] => skills.map((skill_level, i) => ({ id: `p${String(i + 1).padStart(2, "0")}`, name: `P${i + 1}`, skill_level, active: true }))

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
const START_OF_HISTORY = Date.parse("2025-01-05T00:00:00Z")
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function row(id: string, t1: [string, string], t2: [string, string], playedAt: string): MatchHistory {
  return {
    id,
    player1_id: t1[0],
    player2_id: t1[1],
    player3_id: t2[0],
    player4_id: t2[1],
    team1_player1_id: t1[0],
    team1_player2_id: t1[1],
    team2_player1_id: t2[0],
    team2_player2_id: t2[1],
    played_at: playedAt,
    created_at: "",
  }
}

const foursomeKey = (m: { team1: readonly Player[]; team2: readonly Player[] }) => [...m.team1, ...m.team2].map((p) => p.id).sort().join(",")

describe("a season of sessions (regression simulation)", () => {
  // 12 players, four of each level: perfect balance is always reachable
  const ps = roster([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
  const SESSIONS = 13
  const START = Date.parse("2026-01-04T00:00:00Z")

  const weekly = Array.from({ length: SESSIONS }, (_, i) => isoDay(START + i * 7 * DAY))
  /** Gaps of 2 to 20 days between sessions, from a fixed seed, so the same dates every run. */
  const irregular = (() => {
    const gaps = mulberry32(2024)
    let at = START
    return Array.from({ length: SESSIONS }, (_, i) => {
      if (i > 0) at += (2 + Math.floor(gaps() * 19)) * DAY
      return isoDay(at)
    })
  })()

  function playSeason(seed: number, dates: string[]) {
    const rng = mulberry32(seed)
    const history: MatchHistory[] = []
    const lastRematch = new Map<string, number>() // exact match -> session index of its last game
    const lastSameFour = new Map<string, number>() // foursome -> session index of its last game
    const stats = { matches: 0, gap0: 0, maxGap: 0, rematches: 0, rematchesWithin2Sessions: 0, sameFourInLastSession: 0, sameFourWithin2Sessions: 0 }
    const schedule: string[] = []

    dates.forEach((date, session) => {
      const analyzer = new MatchAnalyzer(history, ps, { referenceDate: date, rng })
      const best = analyzer.generateCompleteArrangements(ps, 1)[0]
      for (const m of best.matches) {
        stats.matches++
        if (m.skillDifference === 0) stats.gap0++
        stats.maxGap = Math.max(stats.maxGap, m.skillDifference)

        const matchKey = canonicalMatchKey(m)
        const previousMatch = lastRematch.get(matchKey)
        if (previousMatch !== undefined) {
          stats.rematches++
          if (session - previousMatch <= 2) stats.rematchesWithin2Sessions++
        }
        lastRematch.set(matchKey, session)

        const four = foursomeKey(m)
        const previousFour = lastSameFour.get(four)
        if (previousFour !== undefined) {
          if (session - previousFour <= 1) stats.sameFourInLastSession++
          if (session - previousFour <= 2) stats.sameFourWithin2Sessions++
        }
        lastSameFour.set(four, session)

        schedule.push(`${session}:${matchKey}`)
        history.push(row(`s${session}-${stats.matches}`, [m.team1[0].id, m.team1[1].id], [m.team2[0].id, m.team2[1].id], date))
      }
    })
    return { stats, schedule }
  }

  const SEEDS = Array.from({ length: 8 }, (_, i) => i + 1)
  const cases: [string, string[]][] = [
    ["weekly dates", weekly],
    ["irregular dates (gaps of 2 to 20 days)", irregular],
  ]

  it("the irregular dates really are irregular", () => {
    const gaps = irregular.slice(1).map((d, i) => (Date.parse(d) - Date.parse(irregular[i])) / DAY)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20)
    expect(new Set(gaps).size).toBeGreaterThan(5)
    expect(irregular.every((d, i) => i === 0 || d > irregular[i - 1])).toBe(true)
  })

  describe.each(cases)("%s", (_name, dates) => {
    it.each(SEEDS)("keeps teams balanced and avoids repeating matches (seed %i)", (seed) => {
      const { stats: s } = playSeason(seed, dates)
      expect(s.matches).toBe(SESSIONS * 3)
      // balance first
      expect(s.gap0 / s.matches).toBeGreaterThanOrEqual(0.9)
      expect(s.maxGap).toBeLessThanOrEqual(1)
      // never the same match again within 2 sessions of each other
      expect(s.rematchesWithin2Sessions).toBe(0)
      // never the same four players in the last session; rarely within the last two
      expect(s.sameFourInLastSession).toBe(0)
      expect(s.sameFourWithin2Sessions / s.matches).toBeLessThanOrEqual(0.05)
      // exact rematches of any age stay rare
      expect(s.rematches / s.matches).toBeLessThanOrEqual(0.05)
    })
  })

  it.each(SEEDS)("only the order of the dates matters: weekly and irregular dates give the same schedule (seed %i)", (seed) => {
    expect(playSeason(seed, irregular).schedule).toEqual(playSeason(seed, weekly).schedule)
  })

  it("is deterministic for a given seed", () => {
    expect(playSeason(7, weekly)).toEqual(playSeason(7, weekly))
  })
})

describe("generation time", () => {
  it("12 players with a 150-match history finish well inside the budget with the default sampling", () => {
    const ps = roster([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
    const rng = mulberry32(99)
    const pick = (n: number) => Math.min(n - 1, Math.floor(rng() * n))
    const history: MatchHistory[] = []
    for (let i = 0; i < 150; i++) {
      const order = [...ps]
      for (let j = order.length - 1; j > 0; j--) {
        const k = pick(j + 1)
        ;[order[j], order[k]] = [order[k], order[j]]
      }
      const [a, b, c, d] = order.slice(0, 4).map((p) => p.id)
      history.push(row(`h${i}`, [a, b], [c, d], isoDay(START_OF_HISTORY + Math.floor(i / 3) * 7 * DAY)))
    }
    const analyzer = new MatchAnalyzer(history, ps, { rng: mulberry32(5), referenceDate: isoDay(START_OF_HISTORY + 50 * 7 * DAY) })

    // 155,925 distinct schedules exist for 12 players, so all 2000 draws are made
    const spy = vi.spyOn(analyzer as unknown as { sampleSchedule: () => unknown }, "sampleSchedule")
    const started = performance.now()
    const arrangements = analyzer.generateCompleteArrangements(ps, 3)
    const elapsed = performance.now() - started

    expect(DEFAULT_SAMPLING.maxSamples).toBe(2000)
    expect(spy.mock.calls.length).toBe(DEFAULT_SAMPLING.maxSamples)
    expect(arrangements.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1500)
  })
})
