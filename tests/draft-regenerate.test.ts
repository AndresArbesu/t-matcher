import { describe, expect, it, vi } from "vitest"
import { regenerateUnlocked, withLocks, type DraftMatch } from "@/lib/draft"
import { DEFAULT_SAMPLING, MatchAnalyzer, canonicalMatchKey, canonicalScheduleKey } from "@/lib/match-analyzer"
import type { MatchHistory, Player } from "@/lib/types"

const NOW = Date.parse("2026-11-15T12:00:00Z")
const roster = (n: number, skill = (i: number) => (i % 3) + 1): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${String(i + 1).padStart(2, "0")}`, name: `P${i + 1}`, skill_level: skill(i), active: true }))

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ids = (m: { team1: Player[]; team2: Player[] }) => [...m.team1, ...m.team2].map((p) => p.id)
const scheduleKey = (draft: DraftMatch[]) => canonicalScheduleKey(draft)

function startingDraft(ps: Player[], seed: number, history: MatchHistory[] = []) {
  const analyzer = new MatchAnalyzer(history, ps, { rng: mulberry32(seed), now: () => NOW })
  return { analyzer, draft: withLocks(analyzer.generateCompleteArrangements(ps, 1)[0].matches) }
}

describe("regenerateUnlocked with sampled remainders", () => {
  it("preserves locked matches byte-for-byte in their positions and covers everyone once", () => {
    const ps = roster(12)
    const { analyzer, draft } = startingDraft(ps, 1)
    draft[1] = { ...draft[1], locked: true }
    const before = JSON.stringify(draft[1])

    for (let run = 0; run < 25; run++) {
      const next = regenerateUnlocked(analyzer, ps, draft)
      expect(next).toHaveLength(3)
      expect(next[1]).toBe(draft[1])
      expect(JSON.stringify(next[1])).toBe(before)
      expect(next[0].locked).toBe(false)
      expect(next[2].locked).toBe(false)
      expect(next.flatMap(ids).sort()).toEqual(ps.map((p) => p.id).sort())
    }
  })

  it("keeps locked matches in place when the locked ones are first and last", () => {
    const ps = roster(16)
    const { analyzer, draft } = startingDraft(ps, 2)
    draft[0] = { ...draft[0], locked: true }
    draft[3] = { ...draft[3], locked: true }
    const next = regenerateUnlocked(analyzer, ps, draft)
    expect(next[0]).toBe(draft[0])
    expect(next[3]).toBe(draft[3])
    expect(next.flatMap(ids).sort()).toEqual(ps.map((p) => p.id).sort())
  })

  it("never hands back the identical schedule when alternatives exist (4 free players)", () => {
    const ps = roster(8)
    for (let seed = 1; seed <= 20; seed++) {
      const { analyzer, draft } = startingDraft(ps, seed)
      draft[0] = { ...draft[0], locked: true }
      const next = regenerateUnlocked(analyzer, ps, draft)
      expect(canonicalMatchKey(next[1])).not.toBe(canonicalMatchKey(draft[1]))
      expect(ids(next[1]).sort()).toEqual(ids(draft[1]).sort())
    }
  })

  it("never hands back the identical schedule when everything is open (8 and 12 players)", () => {
    for (const n of [8, 12]) {
      const ps = roster(n)
      for (let seed = 1; seed <= 15; seed++) {
        const { analyzer, draft } = startingDraft(ps, seed)
        const next = regenerateUnlocked(analyzer, ps, draft)
        expect(scheduleKey(next)).not.toBe(scheduleKey(draft))
        expect(next.flatMap(ids).sort()).toEqual(ps.map((p) => p.id).sort())
      }
    }
  })

  it("treats a reordering of the same matches as identical", () => {
    const ps = roster(8)
    const { analyzer, draft } = startingDraft(ps, 4)
    const reordered = [draft[1], draft[0]]
    expect(scheduleKey(reordered)).toBe(scheduleKey(draft))
    expect(scheduleKey(regenerateUnlocked(analyzer, ps, reordered))).not.toBe(scheduleKey(draft))
  })

  it("chooses by full ranking: of the alternative splits it takes the one history does not penalise", () => {
    const ps = roster(4, () => 3)
    const [a, b, c, d] = ps
    const played = (id: string, t1: [string, string], t2: [string, string]): MatchHistory => ({
      id,
      player1_id: t1[0],
      player2_id: t1[1],
      player3_id: t2[0],
      player4_id: t2[1],
      team1_player1_id: t1[0],
      team1_player2_id: t1[1],
      team2_player1_id: t2[0],
      team2_player2_id: t2[1],
      played_at: "2026-11-14",
      created_at: "",
    })
    // a+b vs c+d was played yesterday; the draft shows a+c vs b+d. The only clean alternative is a+d vs b+c.
    const analyzer = new MatchAnalyzer([played("h", [a.id, b.id], [c.id, d.id])], ps, { rng: mulberry32(8), now: () => NOW })
    const draft = withLocks([analyzer.scoreMatch([a, c], [b, d])])
    for (let run = 0; run < 10; run++) {
      const next = regenerateUnlocked(analyzer, ps, draft)
      expect(canonicalMatchKey(next[0])).toBe(canonicalMatchKey({ team1: [a, d], team2: [b, c] }))
    }
  })

  it("bounds the work for 20 players", () => {
    const ps = roster(20)
    const { analyzer, draft } = startingDraft(ps, 3)
    const spy = vi.spyOn(analyzer, "scoreMatch")
    regenerateUnlocked(analyzer, ps, draft)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(DEFAULT_SAMPLING.maxSamples * 5)
  })

  it("still rejects a participant list that no longer fits the draft", () => {
    const ps = roster(8)
    const { analyzer, draft } = startingDraft(ps, 5)
    expect(() => regenerateUnlocked(analyzer, ps.slice(0, 7), draft)).toThrow(/generate again/i)
  })
})
