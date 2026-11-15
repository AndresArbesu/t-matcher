import { describe, expect, it } from "vitest"
import { DEFAULT_RULES, MatchAnalyzer } from "@/lib/match-analyzer"
import type { MatchHistory, Player } from "@/lib/types"

const roster = (skills: number[]): Player[] => skills.map((skill_level, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, skill_level, active: true }))
const NOW = Date.parse("2026-11-15T12:00:00Z")

function played(id: string, t1: [string, string], t2: [string, string], playedAt = "2026-01-01"): MatchHistory {
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

describe("DEFAULT_RULES", () => {
  it("documents the scoring weights in one typed object", () => {
    expect(DEFAULT_RULES).toEqual({
      skillDifferenceWeight: 10,
      rivalPairPenalty: 1000,
      individualRivalPenalty: 500,
      ownPairPenalty: 300,
      recentWindowDays: 7,
      recentMultiplier: 3,
      recentPlayPenalty: 2000,
    })
  })

  it("drives the score: custom rules change the breakdown", () => {
    const ps = roster([3, 3, 3, 3])
    const history = [played("h", ["p1", "p2"], ["p3", "p4"])]
    const analyzer = new MatchAnalyzer(history, ps, { now: () => NOW, rules: { ...DEFAULT_RULES, rivalPairPenalty: 7 } })
    expect(analyzer.scoreMatch([ps[0], ps[1]], [ps[2], ps[3]]).breakdown.rivalPairPenalty).toBe(7)
  })
})

describe("historical scoring", () => {
  const ps = roster([3, 3, 3, 3, 3, 3])
  const [p1, p2, p3, p4, p5, p6] = ps
  const analyze = (history: MatchHistory[], t1: [Player, Player], t2: [Player, Player]) =>
    new MatchAnalyzer(history, ps, { now: () => NOW }).analyzeMatch(t1, t2)
  const base = [played("h", ["p1", "p2"], ["p3", "p4"])]

  it("counts one individual rival encounter per opposing player pair seen before", () => {
    // p1-p3 were opponents before and are opponents again; nobody else repeats
    const a = analyze(base, [p1, p5], [p3, p6])
    expect(a.individualRivalCount).toBe(1)
    expect(a.rivalPairCount).toBe(0)
  })

  it("counts every repeated opposing pair, not only when all four players repeat", () => {
    // p1 vs p3 and p1 vs p4 repeat
    const a = analyze(base, [p1, p5], [p3, p4])
    expect(a.individualRivalCount).toBe(2)
  })

  it("does not count former teammates who now face each other as rivals", () => {
    // p1+p2 were partners; now p1 faces p2. Only p1-p4 and p3-p2 were opponents before.
    const a = analyze(base, [p1, p3], [p2, p4])
    expect(a.individualRivalCount).toBe(2)
  })

  it("does not count former opponents who are now partners as rivals", () => {
    const a = analyze(base, [p1, p3], [p5, p6])
    expect(a.individualRivalCount).toBe(0)
  })

  it("counts an exact rematch once, as a rival pair, without piling individual rivals on top", () => {
    const a = analyze(base, [p3, p4], [p1, p2])
    expect(a.rivalPairCount).toBe(1)
    expect(a.individualRivalCount).toBe(0)
  })

  it("flags recent play when an individual rival repeat happened within the window", () => {
    const recent = [played("h", ["p1", "p2"], ["p3", "p4"], "2026-11-12")]
    const a = analyze(recent, [p1, p5], [p3, p6])
    expect(a.isRecentlyPlayed).toBe(true)
    expect(a.lastPlayedDays).toBeGreaterThan(0)
  })

  it("has nothing historical to report for players who never met", () => {
    const a = analyze(base, [p5, p6], [p1, p3])
    expect(a).toMatchObject({ rivalPairCount: 0, individualRivalCount: 0, ownPairCount: 0, lastPlayedDays: -1, isRecentlyPlayed: false })
  })
})
