import { describe, expect, it } from "vitest"
import { hydrateDraft, regenerateUnlocked, toDraftPayload, withLocks } from "@/lib/draft"
import { toMatchHistory } from "@/lib/history"
import { MatchAnalyzer } from "@/lib/match-analyzer"
import type { MatchHistory, Player, SavedMatch } from "@/lib/types"

const players: Player[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  skill_level: (i % 5) + 1,
  active: true,
}))
const byId = new Map(players.map((p) => [p.id, p]))
const analyzer = new MatchAnalyzer([], players)

const ids = (m: { team1: Player[]; team2: Player[] }) => [...m.team1, ...m.team2].map((p) => p.id)

function freshDraft() {
  const arrangement = analyzer.generateCompleteArrangements(players, 1)[0]
  return withLocks(arrangement.matches)
}

describe("withLocks", () => {
  it("marks every match unlocked", () => {
    expect(freshDraft().map((m) => m.locked)).toEqual([false, false])
  })
})

describe("regenerateUnlocked", () => {
  it("keeps locked matches in their slot and re-pairs only the other players", () => {
    const draft = freshDraft()
    draft[1] = { ...draft[1], locked: true }
    for (let run = 0; run < 20; run++) {
      const next = regenerateUnlocked(analyzer, players, draft)
      expect(next).toHaveLength(2)
      expect(next[1]).toBe(draft[1])
      expect(next[1].locked).toBe(true)
      expect(next[0].locked).toBe(false)
      expect(ids(next[0]).sort()).toEqual(ids(draft[0]).sort())
    }
  })

  it("covers every participant exactly once when several matches are unlocked", () => {
    const draft = freshDraft()
    const next = regenerateUnlocked(analyzer, players, draft)
    expect(next.flatMap(ids).sort()).toEqual(players.map((p) => p.id).sort())
  })

  it("returns the draft unchanged when everything is locked", () => {
    const draft = freshDraft().map((m) => ({ ...m, locked: true }))
    const next = regenerateUnlocked(analyzer, players, draft)
    expect(next).toEqual(draft)
  })

  it("scores refilled slots against recorded history", () => {
    const twelve: Player[] = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, name: `Q${i}`, skill_level: 3, active: true }))
    const history = [toMatchHistory({ id: "h", notes: null, created_at: "", team1_player1_id: "q0", team1_player2_id: "q1", team2_player1_id: "q2", team2_player2_id: "q3" }, new Date().toISOString().slice(0, 10))]
    const an = new MatchAnalyzer(history, twelve)
    const draft = withLocks([an.scoreMatch([twelve[4], twelve[5]], [twelve[6], twelve[7]]), an.scoreMatch([twelve[0], twelve[1]], [twelve[2], twelve[3]]), an.scoreMatch([twelve[8], twelve[9]], [twelve[10], twelve[11]])])
    draft[0] = { ...draft[0], locked: true }
    draft[2] = { ...draft[2], locked: true }
    const next = regenerateUnlocked(an, twelve, draft)
    // slot 1 held the already-played match; the same four players are the only option, but order is still valid
    expect(ids(next[1]).sort()).toEqual(["q0", "q1", "q2", "q3"])
    expect(next[1].totalScore).toBeGreaterThan(0)
  })
})

describe("persistence mapping", () => {
  const saved = (id: string, team1: [string, string], team2: [string, string], extra: Partial<SavedMatch> = {}): SavedMatch => ({
    id,
    position: 0,
    team1,
    team2,
    locked: false,
    played: false,
    notes: null,
    ...extra,
  })

  it("hydrates unplayed saved matches into scored matches with their lock state", () => {
    const draft = hydrateDraft(
      [saved("m1", ["p1", "p2"], ["p3", "p4"], { locked: true }), saved("m2", ["p5", "p6"], ["p7", "p8"], { played: true })],
      byId,
      analyzer,
    )
    expect(draft).toHaveLength(1)
    expect(draft[0].locked).toBe(true)
    expect(ids(draft[0])).toEqual(["p1", "p2", "p3", "p4"])
    expect(typeof draft[0].totalScore).toBe("number")
  })

  it("rejects saved matches that reference an unknown player instead of hiding it", () => {
    expect(() => hydrateDraft([saved("m1", ["p1", "zz"], ["p3", "p4"])], byId, analyzer)).toThrow(/unknown player/i)
  })

  it("serializes participants and ordered matches for the API", () => {
    const draft = freshDraft()
    draft[0] = { ...draft[0], locked: true }
    const payload = toDraftPayload(["p1", "p2"], draft)
    expect(payload.participants).toEqual(["p1", "p2"])
    expect(payload.matches[0]).toEqual({ team1: draft[0].team1.map((p) => p.id), team2: draft[0].team2.map((p) => p.id), locked: true })
    expect(payload.matches[1].locked).toBe(false)
  })
})

describe("recorded matches feed historical scoring", () => {
  it("maps a played match to the history shape and raises the repeat score", () => {
    const row = { id: "h1", notes: "n", created_at: "2026-11-01T10:00:00Z", team1_player1_id: "p1", team1_player2_id: "p2", team2_player1_id: "p3", team2_player2_id: "p4" }
    const h: MatchHistory = toMatchHistory(row, "2026-11-01")
    expect(h).toMatchObject({ player1_id: "p1", player4_id: "p4", played_at: "2026-11-01", team2_player2_id: "p4" })

    const before = new MatchAnalyzer([], players).scoreMatch([byId.get("p1")!, byId.get("p2")!], [byId.get("p3")!, byId.get("p4")!])
    const after = new MatchAnalyzer([h], players).scoreMatch([byId.get("p1")!, byId.get("p2")!], [byId.get("p3")!, byId.get("p4")!])
    expect(after.analysis.rivalPairCount).toBe(1)
    expect(after.totalScore).toBeGreaterThan(before.totalScore)
  })
})
