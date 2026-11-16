import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SAMPLING, MatchAnalyzer, canonicalMatchKey, canonicalScheduleKey } from "@/lib/match-analyzer"
import type { MatchHistory, Player } from "@/lib/types"

const NOW = Date.parse("2026-11-15T12:00:00Z")
const roster = (skills: number[]): Player[] => skills.map((skill_level, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, skill_level, active: true }))
const cycleSkills = (n: number) => Array.from({ length: n }, (_, i) => (i % 3) + 1)
const idsOf = (m: { team1: Player[]; team2: Player[] }) => [...m.team1, ...m.team2].map((p) => p.id)
type Pair = [Player, Player]

function played(id: string, t1: [string, string], t2: [string, string], playedAt: string): MatchHistory {
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

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("complete schedule sampling", () => {
  for (const n of [4, 8, 12, 20]) {
    it(`covers each of ${n} players exactly once in every candidate, ranked by total score`, () => {
      const ps = roster(cycleSkills(n))
      const analyzer = new MatchAnalyzer([], ps, { rng: mulberry32(n), now: () => NOW })
      const candidates = analyzer.generateCompleteArrangements(ps, 3)

      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.length).toBeLessThanOrEqual(3)
      for (const c of candidates) {
        expect(c.matches).toHaveLength(n / 4)
        const used = c.matches.flatMap(idsOf)
        expect(used).toHaveLength(n)
        expect([...used].sort()).toEqual(ps.map((p) => p.id).sort())
        expect([...c.usedPlayers].sort()).toEqual(ps.map((p) => p.id).sort())
        expect(c.totalScore).toBe(c.matches.reduce((sum, m) => sum + m.totalScore, 0))
      }
      const scores = candidates.map((c) => c.totalScore)
      expect(scores).toEqual([...scores].sort((a, b) => a - b))
      expect(new Set(candidates.map((c) => canonicalScheduleKey(c.matches))).size).toBe(candidates.length)
    })
  }

  it("returns nothing for rosters that are not a positive multiple of four", () => {
    for (const n of [0, 3, 5, 10]) {
      const ps = roster(cycleSkills(n))
      expect(new MatchAnalyzer([], ps).generateCompleteArrangements(ps, 3)).toEqual([])
    }
  })

  it("finds exactly the 3 distinct team splits for 4 players and stops, even with a stuck RNG", () => {
    const ps = roster([1, 2, 3, 4])
    for (const rng of [mulberry32(1), () => 0, () => 0.999999]) {
      const analyzer = new MatchAnalyzer([], ps, { rng, now: () => NOW })
      const candidates = analyzer.generateCompleteArrangements(ps, 5)
      expect(candidates).toHaveLength(3)
      expect(new Set(candidates.map((c) => canonicalScheduleKey(c.matches))).size).toBe(3)
    }
  })

  it("terminates within the sample budget when the RNG is stuck on a larger roster", () => {
    const ps = roster(cycleSkills(8))
    const analyzer = new MatchAnalyzer([], ps, { rng: () => 0, now: () => NOW, sampling: { maxSamples: 25 } })
    const spy = vi.spyOn(analyzer, "scoreMatch")
    const candidates = analyzer.generateCompleteArrangements(ps, 3)
    expect(candidates).toHaveLength(1)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(25 * 2)
  })

  it("canonicalizes players inside teams, team order and match order", () => {
    const ps = roster(cycleSkills(12))
    const analyzer = new MatchAnalyzer([], ps, { rng: mulberry32(7), now: () => NOW })
    for (const c of analyzer.generateCompleteArrangements(ps, 3)) {
      for (const m of c.matches) {
        for (const team of [m.team1, m.team2]) expect(team[0].id < team[1].id).toBe(true)
        expect(m.team1.map((p) => p.id).join() < m.team2.map((p) => p.id).join()).toBe(true)
      }
      const keys = c.matches.map(canonicalMatchKey)
      expect(keys).toEqual([...keys].sort())
    }
  })

  it("gives one key to the same match however its teams and players are written", () => {
    const [a, b, c, d] = roster([1, 2, 3, 4])
    expect(canonicalMatchKey({ team1: [a, b], team2: [c, d] })).toBe(canonicalMatchKey({ team1: [d, c], team2: [b, a] }))
    expect(canonicalMatchKey({ team1: [a, b], team2: [c, d] })).not.toBe(canonicalMatchKey({ team1: [a, c], team2: [b, d] }))
  })

  it("is reproducible with the same seeded RNG", () => {
    const ps = roster(cycleSkills(12))
    const run = (seed: number) =>
      new MatchAnalyzer([], ps, { rng: mulberry32(seed), now: () => NOW }).generateCompleteArrangements(ps, 3).map((c) => canonicalScheduleKey(c.matches))
    expect(run(42)).toEqual(run(42))
  })

  it("ranks by FULL schedule score: finds the optimum that greedy match-by-match picking misses", () => {
    // greedy takes the first gap-0 match (2+2 vs 3+1), which strands 3,1,1,1; regrouping 2+3 vs 2+3 and 1+1 vs 1+1 reaches 0
    const ps = roster([2, 2, 3, 3, 1, 1, 1, 1])
    const analyzer = new MatchAnalyzer([], ps, { rng: mulberry32(3), now: () => NOW })

    // greedy baseline: repeatedly take the single best match among the remaining players (first wins ties)
    let pool = [...ps]
    let greedyTotal = 0
    while (pool.length) {
      const best = analyzer.generateScoredSuggestions(pool)[0]
      greedyTotal += best.totalScore
      const used = new Set(idsOf(best))
      pool = pool.filter((p) => !used.has(p.id))
    }
    expect(greedyTotal).toBeGreaterThan(0)

    const best = analyzer.generateCompleteArrangements(ps, 3)[0]
    expect(best.totalScore).toBe(0)
    expect(best.totalScore).toBeLessThan(greedyTotal)
  })

  it("matches an exhaustive search over all 315 schedules of 8 players when history shapes the optimum", () => {
    // p8 stands apart, so skill alone leaves a positive floor and history decides who partners p8
    const ps = roster([1, 1, 1, 1, 1, 1, 1, 3])
    const history = [
      played("a", ["p8", "p1"], ["p2", "p3"], "2026-11-14"),
      played("b", ["p8", "p2"], ["p4", "p5"], "2026-11-01"),
      played("c", ["p1", "p2"], ["p6", "p7"], "2026-10-20"),
    ]
    const analyzer = new MatchAnalyzer(history, ps, { rng: mulberry32(9), now: () => NOW, sampling: { maxSamples: 5000 } })

    const splits = (g: Player[]): [Pair, Pair][] => [
      [[g[0], g[1]], [g[2], g[3]]],
      [[g[0], g[2]], [g[1], g[3]]],
      [[g[0], g[3]], [g[1], g[2]]],
    ]
    let optimum = Number.POSITIVE_INFINITY
    let count = 0
    const rest = ps.slice(1)
    for (let a = 0; a < rest.length; a++) {
      for (let b = a + 1; b < rest.length; b++) {
        for (let c = b + 1; c < rest.length; c++) {
          const g1 = [ps[0], rest[a], rest[b], rest[c]]
          const g2 = ps.filter((p) => !g1.includes(p))
          for (const [a1, a2] of splits(g1)) {
            for (const [b1, b2] of splits(g2)) {
              count++
              optimum = Math.min(optimum, analyzer.scoreMatch(a1, a2).totalScore + analyzer.scoreMatch(b1, b2).totalScore)
            }
          }
        }
      }
    }
    expect(count).toBe(315)
    expect(optimum).toBeGreaterThan(0)
    expect(analyzer.generateCompleteArrangements(ps, 3)[0].totalScore).toBe(optimum)
  })

  it("returns meaningfully different candidates: no two share a match when enough alternatives exist", () => {
    const ps = roster(cycleSkills(8))
    const candidates = new MatchAnalyzer([], ps, { rng: mulberry32(5), now: () => NOW }).generateCompleteArrangements(ps, 3)
    expect(candidates).toHaveLength(3)
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = new Set(candidates[i].matches.map(canonicalMatchKey))
        expect(candidates[j].matches.filter((m) => a.has(canonicalMatchKey(m)))).toEqual([])
      }
    }
  })

  it("never returns duplicate schedules even when many candidates are requested", () => {
    const ps = roster(cycleSkills(8))
    const candidates = new MatchAnalyzer([], ps, { rng: mulberry32(11), now: () => NOW }).generateCompleteArrangements(ps, 40)
    expect(candidates.length).toBeGreaterThan(3)
    expect(new Set(candidates.map((c) => canonicalScheduleKey(c.matches))).size).toBe(candidates.length)
  })

  it("bounds the work for large rosters: match evaluations never exceed the sample budget", () => {
    const ps = roster(cycleSkills(20))
    const analyzer = new MatchAnalyzer([], ps, { rng: mulberry32(1), now: () => NOW, sampling: { maxSamples: 60 } })
    const spy = vi.spyOn(analyzer, "scoreMatch")
    const candidates = analyzer.generateCompleteArrangements(ps, 3)
    expect(candidates.length).toBeGreaterThan(0)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(60 * 5)
  })

  it("uses the default budget when none is given and still finishes quickly for 20 players", () => {
    const ps = roster(cycleSkills(20))
    const analyzer = new MatchAnalyzer([], ps, { rng: mulberry32(2), now: () => NOW })
    const spy = vi.spyOn(analyzer, "scoreMatch")
    const started = Date.now()
    analyzer.generateCompleteArrangements(ps, 3)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(DEFAULT_SAMPLING.maxSamples * 5)
  })
})
