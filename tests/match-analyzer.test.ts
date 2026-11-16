import { describe, expect, it } from "vitest"
import { DEFAULT_RULES, DEFAULT_SAMPLING, MatchAnalyzer, type MatchAnalyzerOptions } from "@/lib/match-analyzer"
import type { MatchHistory, Player } from "@/lib/types"

const roster = (skills: number[]): Player[] => skills.map((skill_level, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, skill_level, active: true }))

const REF = "2026-11-15" // the session being planned
// Played dates before REF, newest first: these are "1 session ago", "2 sessions ago", ...
const SESSION_DATES = ["2026-11-08", "2026-11-01", "2026-10-25", "2026-10-18"]
const OLD = "2026-01-01" // older than every session above

type Pair = [string, string]

function played(id: string, t1: Pair, t2: Pair, playedAt = OLD): MatchHistory {
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

/** The same row `n` times, so counts can be pushed past the caps. */
const repeated = (n: number, t1: Pair, t2: Pair, playedAt = OLD) => Array.from({ length: n }, (_, i) => played(`r${i}`, t1, t2, playedAt))

/** A game between players nobody scores, only there to make a date count as a session. */
const filler = (playedAt: string) => played(`f-${playedAt}`, ["f1", "f2"], ["f3", "f4"], playedAt)

/** Three newer sessions after OLD, so rows dated OLD are 4 sessions ago: plain old history, weighed x1. */
const old = (...rows: MatchHistory[]) => [...rows, ...SESSION_DATES.slice(0, 3).map(filler)]

/** The rows as they were played `rank` sessions ago (1 = the latest session), with a game on each newer session. */
const sessionsAgo = (rank: number, ...rows: MatchHistory[]) => [
  ...SESSION_DATES.slice(0, rank - 1).map(filler),
  ...rows.map((r) => ({ ...r, played_at: SESSION_DATES[rank - 1] })),
]

const R = DEFAULT_RULES
const FLAT_NEAR = R.recentPlayPenalty / 2

describe("DEFAULT_RULES", () => {
  it("documents the scoring weights in one typed object", () => {
    expect(DEFAULT_RULES).toEqual({
      skillDifferenceWeight: 1000,
      rivalPairPenalty: 200,
      individualRivalPenalty: 25,
      ownPairPenalty: 20,
      recentSessions: 1,
      nearSessions: 2,
      recentMultiplier: 3,
      nearMultiplier: 2,
      recentPlayPenalty: 100,
      maxCountedRematches: 2,
      maxCountedRivalMeetings: 2,
      maxCountedPartnerships: 2,
    })
  })

  it("has no day-based window left", () => {
    expect(Object.keys(DEFAULT_RULES).filter((k) => /day/i.test(k))).toEqual([])
  })

  it("samples up to 2000 complete schedules by default", () => {
    expect(DEFAULT_SAMPLING.maxSamples).toBe(2000)
  })

  it("drives the score: custom rules change the breakdown and the caps", () => {
    const ps = roster([2, 2, 2, 2])
    const history = [played("h", ["p1", "p2"], ["p3", "p4"])]
    const custom = new MatchAnalyzer(history, ps, { referenceDate: REF, rules: { ...R, rivalPairPenalty: 7 } })
    expect(custom.scoreMatch([ps[0], ps[1]], [ps[2], ps[3]]).breakdown.rivalPairPenalty).toBe(7 * R.recentMultiplier)

    const capped = new MatchAnalyzer(old(...repeated(5, ["p1", "p2"], ["p3", "p4"])), ps, { referenceDate: REF, rules: { ...R, maxCountedRematches: 1 } })
    expect(capped.scoreMatch([ps[0], ps[1]], [ps[2], ps[3]]).breakdown.rivalPairPenalty).toBe(R.rivalPairPenalty)
  })
})

describe("skill balance", () => {
  it("charges the weight per level of gap between the teams' summed levels", () => {
    const ps = roster([1, 2, 3, 3]) // 1+2 = 3 against 3+3 = 6
    const scored = new MatchAnalyzer([], ps, { referenceDate: REF }).scoreMatch([ps[0], ps[1]], [ps[2], ps[3]])
    expect(scored.skillDifference).toBe(3)
    expect(scored.breakdown.skillScore).toBe(3 * R.skillDifferenceWeight)
    expect(scored.totalScore).toBe(3 * R.skillDifferenceWeight)
  })

  it("does not care which end of the scale is the strong one: only the gap counts", () => {
    const levels = [1, 2, 3, 3, 1, 2]
    const flipped = levels.map((l) => 4 - l)
    const total = (skills: number[]) => {
      const ps = roster(skills)
      const analyzer = new MatchAnalyzer([], ps, { referenceDate: REF })
      return [
        analyzer.scoreMatch([ps[0], ps[1]], [ps[2], ps[3]]).totalScore,
        analyzer.scoreMatch([ps[0], ps[4]], [ps[2], ps[5]]).totalScore,
        analyzer.scoreMatch([ps[1], ps[3]], [ps[4], ps[5]]).totalScore,
      ]
    }
    expect(total(flipped)).toEqual(total(levels))
  })
})

describe("historical counts", () => {
  const ps = roster([2, 2, 2, 2, 2, 2, 2, 2])
  const [p1, p2, p3, p4, p5, p6] = ps
  const analyze = (history: MatchHistory[], t1: [Player, Player], t2: [Player, Player]) =>
    new MatchAnalyzer(history, ps, { referenceDate: REF }).analyzeMatch(t1, t2)
  const base = [played("h", ["p1", "p2"], ["p3", "p4"])]

  it("counts one individual rival encounter per opposing player pair seen before", () => {
    // p1-p3 were opponents before and are opponents again; nobody else repeats
    const a = analyze(base, [p1, p5], [p3, p6])
    expect(a.individualRivalCount).toBe(1)
    expect(a.rivalPairCount).toBe(0)
    expect(a.ownPairCount).toBe(0)
  })

  it("counts every repeated opposing pair, not only when all four players repeat", () => {
    // p1 vs p3 and p1 vs p4 repeat
    expect(analyze(base, [p1, p5], [p3, p4]).individualRivalCount).toBe(2)
  })

  it("does not count former teammates who now face each other as rivals", () => {
    // p1+p2 were partners; now p1 faces p2. Only p1-p4 and p3-p2 were opponents before.
    expect(analyze(base, [p1, p3], [p2, p4]).individualRivalCount).toBe(2)
  })

  it("does not count former opponents who are now partners as rivals or as a pair", () => {
    const a = analyze(base, [p1, p3], [p5, p6])
    expect(a.individualRivalCount).toBe(0)
    expect(a.ownPairCount).toBe(0)
  })

  it("counts earlier partnerships of either team", () => {
    const a = analyze(base, [p1, p2], [p5, p6])
    expect(a.ownPairCount).toBe(1)
    expect(analyze(base, [p3, p4], [p1, p2]).ownPairCount).toBe(2)
  })

  it("counts an exact rematch as a rematch AND as the four opposing pairs and two partnerships inside it", () => {
    for (const [t1, t2] of [
      [[p1, p2], [p3, p4]],
      [[p3, p4], [p1, p2]],
      [[p2, p1], [p4, p3]],
    ] as [[Player, Player], [Player, Player]][]) {
      const a = analyze(base, t1, t2)
      expect(a.rivalPairCount).toBe(1)
      expect(a.individualRivalCount).toBe(4)
      expect(a.ownPairCount).toBe(2)
    }
  })

  it("reports raw, uncapped counts for display", () => {
    const a = analyze(repeated(10, ["p1", "p2"], ["p3", "p4"]), [p1, p2], [p3, p4])
    expect(a).toMatchObject({ rivalPairCount: 10, individualRivalCount: 40, ownPairCount: 20 })
  })

  it("has nothing historical to report for players who never met", () => {
    const a = analyze(base, [p5, p6], [p1, p3])
    expect(a).toMatchObject({ rivalPairCount: 0, individualRivalCount: 0, ownPairCount: 0, lastPlayedSessions: -1, isRecentlyPlayed: false })
  })
})

describe("recency is counted in sessions (played dates), never in days", () => {
  const ps = roster([2, 2, 2, 2, 2, 2])
  const [p1, p2, p3, p4] = ps
  // p1 and p3 were opponents in the repeat row; that is the only repeat inside p1+p2 vs p3+p4
  const repeat = (playedAt: string) => played("rep", ["p1", "p5"], ["p3", "p6"], playedAt)
  const score = (history: MatchHistory[], options: MatchAnalyzerOptions = { referenceDate: REF }) =>
    new MatchAnalyzer(history, ps, options).scoreMatch([p1, p2], [p3, p4])

  it("the latest session before the session date is 1 session ago: x3 and the full flat penalty", () => {
    const s = score([repeat("2026-11-08")])
    expect(s.analysis).toMatchObject({ lastPlayedSessions: 1, isRecentlyPlayed: true })
    expect(s.recentlyPlayed).toBe(true)
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * R.recentMultiplier)
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
  })

  it("a gap of 40 days between two sessions still makes the earlier one 1 session ago", () => {
    const s = score([repeat("2026-10-06")])
    expect(s.analysis).toMatchObject({ lastPlayedSessions: 1, isRecentlyPlayed: true })
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * R.recentMultiplier)
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
  })

  it("three played dates inside 7 calendar days are three sessions: the earliest is 3 sessions ago, x1, no flat penalty", () => {
    const history = [filler("2026-11-14"), filler("2026-11-12"), repeat("2026-11-10")]
    const s = score(history)
    expect(s.analysis).toMatchObject({ lastPlayedSessions: 3, isRecentlyPlayed: false })
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty)
    expect(s.breakdown.recentPlayPenalty).toBe(0)
    // and the middle one is 2 sessions ago
    expect(score([filler("2026-11-14"), repeat("2026-11-12")]).analysis.lastPlayedSessions).toBe(2)
    expect(score([repeat("2026-11-14"), filler("2026-11-12"), filler("2026-11-10")]).analysis.lastPlayedSessions).toBe(1)
  })

  it("2 sessions ago is x2 with half the flat penalty, and it is not 'recent'", () => {
    const s = score(sessionsAgo(2, repeat("")))
    expect(s.analysis).toMatchObject({ lastPlayedSessions: 2, isRecentlyPlayed: false })
    expect(s.recentlyPlayed).toBe(false)
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * R.nearMultiplier)
    expect(s.breakdown.recentPlayPenalty).toBe(FLAT_NEAR)
  })

  it("3 or more sessions ago is x1 with no flat penalty, however far back", () => {
    for (const rank of [3, 4]) {
      const s = score(sessionsAgo(rank, repeat("")))
      expect(s.analysis.lastPlayedSessions).toBe(rank)
      expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty)
      expect(s.breakdown.recentPlayPenalty).toBe(0)
    }
    expect(score(old(repeat(OLD))).analysis.lastPlayedSessions).toBe(4)
  })

  it("only the distinct played dates count: several games on one date are one session", () => {
    const history = [filler("2026-11-12"), { ...filler("2026-11-12"), id: "another" }, repeat("2026-11-08")]
    expect(score(history).analysis.lastPlayedSessions).toBe(2)
  })

  it("the number of days between the dates and the weekday do not matter", () => {
    // Tue, Wed, Thu, and Sat/Sun all alike: the order of dates is all there is
    const a = score([filler("2026-11-12"), repeat("2026-11-11")])
    const b = score([filler("2026-08-02"), repeat("2026-02-14")])
    expect(a.totalScore).toBe(b.totalScore)
    expect(a.analysis).toEqual(b.analysis)
  })

  it("only the first 10 characters of played_at are the date; the time of day is ignored", () => {
    const s = score([filler("2026-11-12T23:59:59.000Z"), repeat("2026-11-08T00:00:00.000Z")])
    expect(s.analysis.lastPlayedSessions).toBe(2)
    expect(score([filler("2026-11-12T00:00:00.000Z"), repeat("2026-11-12T23:59:59.000Z")]).analysis.lastPlayedSessions).toBe(1)
  })

  it("a row on the session date itself is 1 session ago", () => {
    const s = score([repeat(REF)])
    expect(s.analysis).toMatchObject({ lastPlayedSessions: 1, isRecentlyPlayed: true })
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
  })

  it("rows dated after the session date are ignored: they neither score nor push other sessions back", () => {
    expect(score([repeat("2026-11-20")]).analysis).toMatchObject({ rivalPairCount: 0, individualRivalCount: 0, ownPairCount: 0, lastPlayedSessions: -1 })
    expect(score([repeat("2026-11-08"), filler("2026-11-20"), filler("2026-12-01")]).analysis.lastPlayedSessions).toBe(1)
  })

  it("without a session date, uses the UTC date of the clock, whatever the time of day", () => {
    const history = [repeat("2026-11-08")]
    const at = (iso: string) => score(history, { now: () => Date.parse(iso) })
    const midnight = at("2026-11-15T00:00:00Z")
    const lateEvening = at("2026-11-15T23:59:00Z")
    expect(midnight.totalScore).toBe(lateEvening.totalScore)
    expect(midnight.breakdown).toEqual(lateEvening.breakdown)
    expect(midnight.analysis).toEqual(lateEvening.analysis)
    expect(midnight.analysis).toMatchObject({ lastPlayedSessions: 1, isRecentlyPlayed: true })

    // a game dated the next UTC day is still in the future at 23:59 and is the latest session at 00:00
    const tomorrow = [repeat("2026-11-16")]
    expect(score(tomorrow, { now: () => Date.parse("2026-11-15T23:59:00Z") }).analysis.lastPlayedSessions).toBe(-1)
    expect(score(tomorrow, { now: () => Date.parse("2026-11-16T00:00:00Z") }).analysis.lastPlayedSessions).toBe(1)
  })

  it("prefers an explicit session date over the clock", () => {
    const farFuture = Date.parse("2030-01-01T12:00:00Z")
    expect(score([repeat("2026-11-08"), filler("2026-11-12")], { referenceDate: REF, now: () => farFuture }).analysis.lastPlayedSessions).toBe(2)
  })

  it("falls back to the clock when the session date is not a valid date", () => {
    const s = score([repeat("2026-11-08")], { referenceDate: "soon", now: () => Date.parse("2026-11-15T10:00:00Z") })
    expect(s.analysis.lastPlayedSessions).toBe(1)
  })

  it("a row without a usable date still counts as a repeat but is never recent", () => {
    const s = score([repeat("")])
    expect(s.analysis).toMatchObject({ individualRivalCount: 1, isRecentlyPlayed: false })
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty)
    expect(s.breakdown.recentPlayPenalty).toBe(0)
  })

  it("judges recency per repeated item by the latest session in which that item happened", () => {
    // p1-p3 met long ago and again 1 session ago: the pair's latest meeting is recent, so the whole item is tripled
    const history = [played("a", ["p1", "p5"], ["p3", "p6"], OLD), repeat("2026-11-08")]
    expect(score(history).breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * 2 * R.recentMultiplier)
  })

  it("grades each item on its own latest session", () => {
    // p1-p3 last met 3 sessions ago (x1); p2-p4 last met 2 sessions ago (x2)
    const history = [
      filler("2026-11-08"),
      played("a", ["p2", "p5"], ["p4", "p6"], "2026-11-01"),
      played("b", ["p1", "p5"], ["p3", "p6"], "2026-10-25"),
    ]
    const s = score(history)
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * R.nearMultiplier + R.individualRivalPenalty)
    expect(s.breakdown.recentPlayPenalty).toBe(FLAT_NEAR)
    expect(s.analysis.lastPlayedSessions).toBe(2)
  })

  it("the flat penalty is the full one when any item is 1 session ago, even with other items 2 sessions ago", () => {
    const history = [
      played("a", ["p2", "p5"], ["p4", "p6"], "2026-11-01"),
      played("b", ["p1", "p5"], ["p3", "p6"], "2026-11-08"),
    ]
    const s = score(history)
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
    expect(s.breakdown.individualRivalPenalty).toBe(R.individualRivalPenalty * R.recentMultiplier + R.individualRivalPenalty * R.nearMultiplier)
    expect(s.analysis.lastPlayedSessions).toBe(1)
  })

  it("lastPlayedSessions is the most recent repeat; -1 when there is none", () => {
    const history = [played("a", ["p1", "p5"], ["p3", "p6"], "2026-11-01"), played("b", ["p2", "p5"], ["p4", "p6"], "2026-11-10")]
    expect(score(history).analysis.lastPlayedSessions).toBe(1)
    expect(score([]).analysis.lastPlayedSessions).toBe(-1)
  })
})

describe("exact rematches", () => {
  const ps = roster([2, 2, 2, 2, 2, 2, 2, 2])
  const [p1, p2, p3, p4] = ps
  const analyzer = (history: MatchHistory[]) => new MatchAnalyzer(history, ps, { referenceDate: REF })
  const wholeCost = R.rivalPairPenalty + 4 * R.individualRivalPenalty + 2 * R.ownPairPenalty
  const game = (playedAt = OLD) => played("h", ["p1", "p2"], ["p3", "p4"], playedAt)

  it("costs at least everything it contains: the rematch, the four opposing pairs and both partnerships", () => {
    const s = analyzer(old(game())).scoreMatch([p1, p2], [p3, p4])
    expect(s.breakdown).toMatchObject({
      rivalPairPenalty: R.rivalPairPenalty,
      individualRivalPenalty: 4 * R.individualRivalPenalty,
      ownPairPenalty: 2 * R.ownPairPenalty,
      recentPlayPenalty: 0,
    })
    expect(s.totalScore).toBeGreaterThanOrEqual(wholeCost)
    expect(s.totalScore).toBe(wholeCost)
  })

  it("costs strictly more than a different match whose four opposing pairs and two partnerships were each seen once", () => {
    const history = [
      played("r1", ["p1", "p2"], ["p5", "p6"]), // partners p1+p2
      played("r2", ["p3", "p4"], ["p7", "p8"]), // partners p3+p4
      played("r3", ["p1", "p5"], ["p3", "p6"]), // p1 vs p3
      played("r4", ["p1", "p7"], ["p4", "p8"]), // p1 vs p4
      played("r5", ["p2", "p6"], ["p3", "p8"]), // p2 vs p3
      played("r6", ["p2", "p7"], ["p4", "p5"]), // p2 vs p4
    ]
    const parts = analyzer(old(...history)).scoreMatch([p1, p2], [p3, p4])
    expect(parts.analysis).toMatchObject({ rivalPairCount: 0, individualRivalCount: 4, ownPairCount: 2 })
    expect(parts.totalScore).toBe(4 * R.individualRivalPenalty + 2 * R.ownPairPenalty)

    const rematch = analyzer(old(game())).scoreMatch([p1, p2], [p3, p4])
    expect(rematch.totalScore).toBeGreaterThan(parts.totalScore)
  })

  it("the same holds when everything is 1 session ago", () => {
    const history = [
      played("r1", ["p1", "p2"], ["p5", "p6"]),
      played("r2", ["p3", "p4"], ["p7", "p8"]),
      played("r3", ["p1", "p5"], ["p3", "p6"]),
      played("r4", ["p1", "p7"], ["p4", "p8"]),
      played("r5", ["p2", "p6"], ["p3", "p8"]),
      played("r6", ["p2", "p7"], ["p4", "p5"]),
    ]
    const parts = analyzer(sessionsAgo(1, ...history)).scoreMatch([p1, p2], [p3, p4])
    const rematch = analyzer(sessionsAgo(1, game())).scoreMatch([p1, p2], [p3, p4])
    expect(rematch.totalScore).toBeGreaterThan(parts.totalScore)
  })

  it("a rematch of the last session multiplies every item it contains and adds the flat penalty once", () => {
    const s = analyzer(sessionsAgo(1, game())).scoreMatch([p1, p2], [p3, p4])
    expect(s.totalScore).toBe(R.recentMultiplier * wholeCost + R.recentPlayPenalty)
  })

  it("weighs less the further back it was, but never drops to nothing", () => {
    const cost = (rank: number) => analyzer(sessionsAgo(rank, game())).scoreMatch([p1, p2], [p3, p4]).totalScore
    expect(cost(2)).toBe(R.nearMultiplier * wholeCost + FLAT_NEAR)
    expect(cost(3)).toBe(wholeCost)
    expect(cost(4)).toBe(wholeCost)
    expect(cost(1)).toBeGreaterThan(cost(2))
    expect(cost(2)).toBeGreaterThan(cost(3))
    expect(cost(3)).toBeGreaterThan(0)
  })
})

describe("repeat counts are capped", () => {
  const ps = roster([2, 2, 2, 2, 2, 2, 2, 2])
  const [p1, p2, p3, p4] = ps
  const breakdown = (history: MatchHistory[]) => new MatchAnalyzer(old(...history), ps, { referenceDate: REF }).scoreMatch([p1, p2], [p3, p4]).breakdown
  const opposed = (n: number) => repeated(n, ["p1", "p5"], ["p3", "p6"])
  const partners = (n: number) => repeated(n, ["p1", "p2"], ["p5", "p6"])
  const rematches = (n: number) => repeated(n, ["p1", "p2"], ["p3", "p4"])

  it("a pair that was opposed 10 times costs the same as one opposed the maximum counted number of times", () => {
    const cap = R.maxCountedRivalMeetings
    const atCap = breakdown(opposed(cap))
    expect(atCap.individualRivalPenalty).toBe(cap * R.individualRivalPenalty)
    expect(breakdown(opposed(10))).toEqual(atCap)
    expect(breakdown(opposed(cap + 1))).toEqual(atCap)
    // while the last counted meeting still added something
    expect(breakdown(opposed(cap - 1)).individualRivalPenalty).toBeLessThan(atCap.individualRivalPenalty)
  })

  it("a partnership seen 10 times costs the same as one seen the maximum counted number of times", () => {
    const cap = R.maxCountedPartnerships
    const atCap = breakdown(partners(cap))
    expect(atCap.ownPairPenalty).toBe(cap * R.ownPairPenalty)
    expect(breakdown(partners(10))).toEqual(atCap)
    expect(breakdown(partners(cap - 1)).ownPairPenalty).toBeLessThan(atCap.ownPairPenalty)
  })

  it("an exact rematch is capped too, and so are the parts inside it", () => {
    const two = breakdown(rematches(R.maxCountedRematches))
    const ten = breakdown(rematches(10))
    expect(two.rivalPairPenalty).toBe(R.maxCountedRematches * R.rivalPairPenalty)
    expect(ten).toEqual(two)
    expect(ten.individualRivalPenalty).toBe(4 * R.maxCountedRivalMeetings * R.individualRivalPenalty)
    expect(ten.ownPairPenalty).toBe(2 * R.maxCountedPartnerships * R.ownPairPenalty)
  })

  it("bounds the whole repeat cost however long the history gets, so skill always keeps its say", () => {
    const worst = new MatchAnalyzer(old(...rematches(500)), ps, { referenceDate: REF }).scoreMatch([p1, p2], [p3, p4])
    const bound = R.maxCountedRematches * R.rivalPairPenalty + 4 * R.maxCountedRivalMeetings * R.individualRivalPenalty + 2 * R.maxCountedPartnerships * R.ownPairPenalty
    expect(worst.totalScore).toBe(bound)
  })
})

describe("recency does not bleed between items", () => {
  const ps = roster([2, 2, 2, 2, 2, 2, 2, 2])
  const [p1, p2, p3, p4] = ps
  const analyzer = (history: MatchHistory[]) => new MatchAnalyzer(history, ps, { referenceDate: REF })

  it("an old repeat of the same match is not multiplied because one unrelated pair repeated 1 session ago", () => {
    const history = [
      played("old", ["p1", "p2"], ["p3", "p4"], OLD), // the exact match, 4 sessions ago
      played("new", ["p1", "p5"], ["p4", "p6"], SESSION_DATES[0]), // only p1 vs p4 meets again, 1 session ago
      filler(SESSION_DATES[1]),
      filler(SESSION_DATES[2]),
    ]
    const s = analyzer(history).scoreMatch([p1, p2], [p3, p4])
    expect(s.analysis.rivalPairCount).toBe(1)
    expect(s.breakdown.rivalPairPenalty).toBe(R.rivalPairPenalty) // old: not tripled
    expect(s.breakdown.ownPairPenalty).toBe(2 * R.ownPairPenalty) // old: not tripled
    // p1-p4 met twice and last met 1 session ago: that item alone is tripled; the other three opposing pairs are old
    expect(s.breakdown.individualRivalPenalty).toBe(3 * R.individualRivalPenalty + 2 * R.individualRivalPenalty * R.recentMultiplier)
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
  })

  it("charges the flat recent penalty once however many items are recent", () => {
    const history = sessionsAgo(
      1,
      played("a", ["p1", "p5"], ["p3", "p6"]),
      played("b", ["p2", "p7"], ["p4", "p8"]),
      played("c", ["p1", "p2"], ["p5", "p6"]),
    )
    const s = analyzer(history).scoreMatch([p1, p2], [p3, p4])
    expect(s.breakdown.recentPlayPenalty).toBe(R.recentPlayPenalty)
    expect(s.breakdown.individualRivalPenalty).toBe(2 * R.individualRivalPenalty * R.recentMultiplier)
    expect(s.breakdown.ownPairPenalty).toBe(R.ownPairPenalty * R.recentMultiplier)
  })

  it("sums to the total", () => {
    const history = [played("a", ["p1", "p5"], ["p3", "p6"], SESSION_DATES[0]), played("b", ["p1", "p2"], ["p3", "p4"], OLD)]
    const s = analyzer(history).scoreMatch([p1, p2], [p3, p4])
    const b = s.breakdown
    expect(s.totalScore).toBe(b.skillScore + b.rivalPairPenalty + b.individualRivalPenalty + b.ownPairPenalty + b.recentPlayPenalty)
  })
})

describe("balance first; then not replaying the last session's match; then fresh partners and rivals", () => {
  // Match A (gap 0): p1+p2 vs p3+p4. Match B (gap 1, fresh): p5+p6 vs p7+p8 with levels 1,2 vs 2,2.
  // Match C (gap 2, fresh): p9+p10 vs p11+p12 with levels 1,1 vs 2,2.
  const ps = roster([2, 2, 2, 2, 1, 2, 2, 2, 1, 1, 2, 2])
  const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12] = ps
  const analyzer = (history: MatchHistory[]) => new MatchAnalyzer(history, ps, { referenceDate: REF })
  const A = (history: MatchHistory[]) => analyzer(history).scoreMatch([p1, p2], [p3, p4])
  const B = (history: MatchHistory[]) => analyzer(history).scoreMatch([p5, p6], [p7, p8])
  const C = (history: MatchHistory[]) => analyzer(history).scoreMatch([p9, p10], [p11, p12])
  const oneLevel = R.skillDifferenceWeight

  const topMultiplier = Math.max(1, R.recentMultiplier, R.nearMultiplier)
  /** Dearest match that is not an exact rematch: all four opposing pairs and both partnerships at their caps, all 1 session ago. */
  const worstNonRematch = topMultiplier * (4 * R.individualRivalPenalty * R.maxCountedRivalMeetings + 2 * R.ownPairPenalty * R.maxCountedPartnerships) + R.recentPlayPenalty
  /** A match with every item seen exactly once. */
  const oneOfEach = R.rivalPairPenalty + 4 * R.individualRivalPenalty + 2 * R.ownPairPenalty
  const recentRematch = R.recentMultiplier * oneOfEach + R.recentPlayPenalty

  /** Past the caps (by one), without ever replaying A as a whole: p1+p2 and p3+p4 partner others, and all four opposing pairs meet in other games. */
  const worstRepeats = (): MatchHistory[] => {
    const n = Math.max(R.maxCountedRivalMeetings, R.maxCountedPartnerships) + 1
    return [
      ...repeated(n, ["p1", "p2"], ["p9", "p10"]),
      ...repeated(n, ["p3", "p4"], ["p11", "p12"]),
      ...repeated(n, ["p1", "p5"], ["p3", "p6"]),
      ...repeated(n, ["p1", "p7"], ["p4", "p8"]),
      ...repeated(n, ["p2", "p5"], ["p3", "p7"]),
      ...repeated(n, ["p2", "p6"], ["p4", "p8"]),
    ]
  }

  it("rule 1: the worst that repeated partners and rivals can cost is less than one level of gap", () => {
    expect(worstNonRematch).toBeLessThan(oneLevel)
    const worst = A(sessionsAgo(1, ...worstRepeats()))
    expect(worst.analysis.rivalPairCount).toBe(0) // not a rematch
    expect(worst.totalScore).toBe(worstNonRematch)
    expect(worst.totalScore).toBeLessThan(B([]).totalScore)
  })

  it.each([
    ["the last session", 1],
    ["2 sessions ago", 2],
    ["3 sessions ago", 3],
    ["4 sessions ago", 4],
  ])("rule 1 at any recency: a gap-0 match at its capped worst, %s, still beats a fresh gap-1 match", (_name, rank) => {
    const a = A(sessionsAgo(rank, ...worstRepeats()))
    expect(a.skillDifference).toBe(0)
    expect(a.totalScore).toBeLessThanOrEqual(worstNonRematch)
    expect(a.totalScore).toBeLessThan(oneLevel)
    expect(a.totalScore).toBeLessThan(B([]).totalScore)
  })

  it("rule 1: typical repeats never make a gap-0 match lose to a gap-1 match", () => {
    const histories: MatchHistory[][] = [
      old(played("a", ["p1", "p9"], ["p3", "p10"])),
      sessionsAgo(1, played("a", ["p1", "p9"], ["p3", "p10"]), played("b", ["p1", "p2"], ["p9", "p10"])),
      sessionsAgo(1, played("a", ["p1", "p9"], ["p3", "p10"]), played("b", ["p2", "p11"], ["p4", "p12"])),
    ]
    for (const h of histories) expect(A(h).totalScore).toBeLessThan(B(h).totalScore)
  })

  it("rule 2: replaying the last session's match (one occurrence) costs more than one level of gap and less than two", () => {
    expect(recentRematch).toBeGreaterThan(oneLevel)
    expect(recentRematch).toBeLessThan(2 * oneLevel)
    for (const playedAt of [SESSION_DATES[0], REF]) {
      const history = [played("h", ["p1", "p2"], ["p3", "p4"], playedAt)]
      const a = A(history)
      expect(a.skillDifference).toBe(0)
      expect(a.analysis.rivalPairCount).toBe(1)
      expect(a.totalScore).toBe(recentRematch)
      // the engine would rather take a gap of 1 than replay it ...
      expect(a.totalScore).toBeGreaterThan(B(history).totalScore)
      // ... but never a gap of 2
      expect(B(history).skillDifference).toBe(1)
      expect(C(history).skillDifference).toBe(2)
      expect(a.totalScore).toBeLessThan(C(history).totalScore)
    }
  })

  it("rule 2 holds however many sessions of other games came before: only the last session counts as 1 session ago", () => {
    const history = [
      played("h", ["p1", "p2"], ["p3", "p4"], SESSION_DATES[0]),
      filler(SESSION_DATES[1]),
      filler(SESSION_DATES[2]),
    ]
    expect(A(history).totalScore).toBe(recentRematch)
  })

  it("a rematch of 2 sessions ago is discouraged but costs less than one level of gap; older ones less still", () => {
    const rank2 = A(sessionsAgo(2, played("h", ["p1", "p2"], ["p3", "p4"]))).totalScore
    const rank3 = A(sessionsAgo(3, played("h", ["p1", "p2"], ["p3", "p4"]))).totalScore
    expect(rank2).toBeGreaterThan(rank3)
    expect(rank2).toBeLessThan(oneLevel)
    expect(rank3).toBeGreaterThan(0)
  })

  it("the engine, given the choice, keeps a gap-0 match over a gap-2 alternative even after a rematch of the last session", () => {
    // levels 1,2,2,3: only the split 1+3 vs 2+2 is level, the other two splits are 2 levels apart
    const four = roster([1, 2, 2, 3])
    const history = [played("h", ["p1", "p4"], ["p2", "p3"], SESSION_DATES[0])]
    const best = new MatchAnalyzer(history, four, { referenceDate: REF, rng: () => 0.5 }).generateCompleteArrangements(four, 1)[0]
    expect(best.matches).toHaveLength(1)
    expect(best.matches[0].skillDifference).toBe(0)
    expect(best.totalScore).toBe(recentRematch)
  })
})
