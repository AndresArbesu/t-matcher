import type { Player, MatchHistory, MatchSuggestion } from "./types"

export interface MatchAnalysis {
  rivalPairCount: number
  individualRivalCount: number
  ownPairCount: number
  /** How many sessions ago the most recent repeat happened (1 = the last session); -1 when nothing repeats. */
  lastPlayedSessions: number
  /** True when a repeat happened in the last session. */
  isRecentlyPlayed: boolean
}

export interface ScoredSuggestion extends MatchSuggestion {
  analysis: MatchAnalysis
  totalScore: number
  breakdown: {
    skillScore: number
    rivalPairPenalty: number
    individualRivalPenalty: number
    ownPairPenalty: number
    recentPlayPenalty: number
  }
}

export interface Arrangement {
  matches: ScoredSuggestion[]
  totalScore: number
  usedPlayers: Set<string>
}

/**
 * Scoring weights. Lower total score is better. Every number that shapes a
 * suggestion lives here so the rules can be read (and tuned) in one place.
 *
 * Priorities:
 * 1. Balance. Repeated partners and rivals, at their capped worst and however
 *    recent, cost less than one level of gap.
 * 2. Not replaying the match of the last session. One such rematch costs more
 *    than one level of gap and less than two, so a gap of 1 is accepted to
 *    avoid it and a gap of 2 or more never is.
 * 3. Fresh partners and rivals.
 * Repeat counts are capped, so a long history adds only a bounded amount and
 * never buries the skill term; history never expires, it just weighs less.
 *
 * Recency is counted in sessions (distinct played dates), never in days: the
 * group plays when it plays, and the calendar gap between dates is irrelevant.
 */
export interface ScoringRules {
  /** Points per level of difference between the two teams' summed skill. */
  skillDifferenceWeight: number
  /** Per earlier time exactly the same two teams faced each other (capped by `maxCountedRematches`). */
  rivalPairPenalty: number
  /** Per opposing player pair, per earlier time the two stood on opposite sides (capped by `maxCountedRivalMeetings`). */
  individualRivalPenalty: number
  /** Per current team, per earlier time its two players were partners (capped by `maxCountedPartnerships`). */
  ownPairPenalty: number
  /** A repeat is "recent" when its latest occurrence is at most this many sessions before the one being planned (1 = the last session). */
  recentSessions: number
  /** A repeat is "near" when it is recent or at most this many sessions back (2 = the last two sessions). */
  nearSessions: number
  /** Multiplier applied to each repeat item whose own latest occurrence is recent. */
  recentMultiplier: number
  /** Multiplier applied to each repeat item whose own latest occurrence is near but not recent. Older items count x1. */
  nearMultiplier: number
  /** Flat extra penalty, charged once, when any repeat item is recent; half of it when the closest is only near. */
  recentPlayPenalty: number
  /** Most earlier rematches of the same two teams that are charged. */
  maxCountedRematches: number
  /** Most earlier meetings of the same opposing pair that are charged. */
  maxCountedRivalMeetings: number
  /** Most earlier partnerships of the same pair that are charged. */
  maxCountedPartnerships: number
}

export const DEFAULT_RULES: ScoringRules = {
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
}

/** The flat penalty when the closest repeat is only "near": half the recent one. */
export const nearPlayPenalty = (rules: ScoringRules): number => rules.recentPlayPenalty / 2

/** Limits on how hard the generator searches for complete schedules. */
export interface SamplingLimits {
  /** Complete random schedules drawn per call. Match evaluations are at most this times matches per schedule. */
  maxSamples: number
  /** Candidates a caller gets back when it does not ask for a number. */
  maxCandidates: number
  /** Candidates should differ from each other in at least this many matches (capped by the schedule size). */
  minDistinctMatches: number
}

export const DEFAULT_SAMPLING: SamplingLimits = {
  maxSamples: 2000,
  maxCandidates: 3,
  minDistinctMatches: 2,
}

export interface MatchAnalyzerOptions {
  rules?: ScoringRules
  sampling?: Partial<SamplingLimits>
  /** Source of randomness in [0, 1); inject a seeded one in tests. */
  rng?: () => number
  /**
   * The session being planned, "YYYY-MM-DD". History rows before it are the earlier sessions, counted back from it.
   * Defaults to the UTC date of `now`.
   */
  referenceDate?: string
  /** Clock in epoch milliseconds, used only to default `referenceDate`; inject a fixed one in tests. */
  now?: () => number
}

type Team = readonly [Player, Player]
type Pairing = { team1: Team; team2: Team }

const pairKey = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`)
const teamKey = (team: Team) => pairKey(team[0].id, team[1].id)
const matchKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** The first 10 characters of "YYYY-MM-DD…" when they are a real date, else null. ISO dates sort as text. */
function isoDate(value: string | undefined): string | null {
  const head = (value ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(head) && !Number.isNaN(Date.parse(`${head}T00:00:00Z`)) ? head : null
}

/** How often something happened in the history, and how many sessions back its latest occurrence is. */
interface Tally {
  times: number
  /** Sessions ago of the most recent occurrence (1 = the last session); infinite when no row had a usable date. */
  latest: number
}

function bump(map: Map<string, Tally>, key: string, sessionsAgo: number) {
  const tally = map.get(key)
  if (tally) {
    tally.times++
    tally.latest = Math.min(tally.latest, sessionsAgo)
  } else {
    map.set(key, { times: 1, latest: sessionsAgo })
  }
}

/** One key for a match regardless of player order inside teams or which team is listed first. */
export function canonicalMatchKey(match: Pairing): string {
  return matchKeyOf(teamKey(match.team1), teamKey(match.team2))
}

/** One key for a whole schedule regardless of match order. */
export function canonicalScheduleKey(matches: Pairing[]): string {
  return matches.map(canonicalMatchKey).sort().join("/")
}

/** Number of distinct complete schedules for n players: ways to group into foursomes times 3 team splits each. */
function scheduleSpaceSize(n: number): number {
  let size = 1
  for (let left = n; left >= 4; left -= 4) size *= 3 * ((left * (left - 1) * (left - 2) * (left - 3)) / 24)
  for (let k = 2; k <= n / 4; k++) size /= k // matches are unordered
  return size
}

/**
 * Scores matches against the played history, in this order of importance:
 * 1. Balance: the gap between the two teams' summed skill.
 * 2. No repeats: an exact rematch, opposing pairs that already met, partners
 *    that already paired up. Each repeat item is capped and weighed by how
 *    many sessions ago its own latest occurrence was (x3 last session, x2 the
 *    one before, x1 older).
 *
 * Sessions are the distinct played dates before the reference date, newest
 * first. A row dated on the reference date itself belongs to the session being
 * planned and counts as 1 session ago; rows dated after it are ignored.
 *
 * The history is indexed once, here, by player pair and by pair of teams, so
 * scoring a candidate is a handful of map lookups however long the history is.
 */
export class MatchAnalyzer {
  private players: Player[]
  private rules: ScoringRules
  private sampling: SamplingLimits
  private rng: () => number
  /** Times two players were on the same team. */
  private partnerTimes = new Map<string, Tally>()
  /** Times two players were on opposite teams. */
  private opposedTimes = new Map<string, Tally>()
  /** Times these exact two teams played each other. */
  private rematchTimes = new Map<string, Tally>()

  constructor(matchHistory: MatchHistory[], players: Player[], options: MatchAnalyzerOptions = {}) {
    this.players = players
    this.rules = options.rules ?? DEFAULT_RULES
    this.sampling = { ...DEFAULT_SAMPLING, ...options.sampling }
    this.rng = options.rng ?? Math.random

    const reference = isoDate(options.referenceDate) ?? new Date((options.now ?? Date.now)()).toISOString().slice(0, 10)

    // Sessions are the distinct played dates strictly before the session being planned, newest first
    const dated = matchHistory.map((row) => ({ row, date: isoDate(row.played_at) }))
    const earlier = [...new Set(dated.flatMap(({ date }) => (date !== null && date < reference ? [date] : [])))].sort().reverse()
    const sessionsAgo = new Map(earlier.map((date, i) => [date, i + 1]))

    for (const { row, date } of dated) {
      // Later than the session being planned: not part of its past. A row without a usable date is as old as it gets.
      if (date !== null && date > reference) continue
      const age = date === null ? Number.POSITIVE_INFINITY : (sessionsAgo.get(date) ?? 1) // the session's own date is the latest session

      const team1 = [row.team1_player1_id, row.team1_player2_id]
      const team2 = [row.team2_player1_id, row.team2_player2_id]
      const key1 = pairKey(team1[0], team1[1])
      const key2 = pairKey(team2[0], team2[1])

      bump(this.partnerTimes, key1, age)
      bump(this.partnerTimes, key2, age)
      bump(this.rematchTimes, matchKeyOf(key1, key2), age)
      for (const a of team1) for (const b of team2) bump(this.opposedTimes, pairKey(a, b), age)
    }
  }

  /**
   * Looks a candidate up in the history indexes.
   *
   * Three kinds of repeat are counted, each from its own index: the exact two
   * teams meeting again, each of the four opposing pairs meeting again, and
   * each of the two teams partnering again. They are independent, so an exact
   * rematch also incurs the four opposing pairs and both partnerships it
   * contains and therefore always costs more than its parts. Counts in
   * `analysis` are raw (for display); the penalties use the capped counts.
   */
  private inspect(team1: [Player, Player], team2: [Player, Player]) {
    const { rules } = this
    let recent = false
    let near = false
    let latest = Number.POSITIVE_INFINITY

    /** Weighted, capped cost of one repeat item, scaled by how many sessions ago that item's own latest occurrence was. */
    const charge = (tally: Tally | undefined, weight: number, cap: number): number => {
      if (!tally) return 0
      latest = Math.min(latest, tally.latest)
      let multiplier = 1
      if (tally.latest <= rules.recentSessions) {
        recent = true
        multiplier = rules.recentMultiplier
      } else if (tally.latest <= rules.nearSessions) {
        near = true
        multiplier = rules.nearMultiplier
      }
      return weight * Math.min(tally.times, cap) * multiplier
    }

    const key1 = teamKey(team1)
    const key2 = teamKey(team2)

    const rematch = this.rematchTimes.get(matchKeyOf(key1, key2))
    const rivalPairPenalty = charge(rematch, rules.rivalPairPenalty, rules.maxCountedRematches)

    let individualRivalCount = 0
    let individualRivalPenalty = 0
    for (const a of team1) {
      for (const b of team2) {
        const tally = this.opposedTimes.get(pairKey(a.id, b.id))
        individualRivalCount += tally?.times ?? 0
        individualRivalPenalty += charge(tally, rules.individualRivalPenalty, rules.maxCountedRivalMeetings)
      }
    }

    const partners1 = this.partnerTimes.get(key1)
    const partners2 = this.partnerTimes.get(key2)
    const ownPairPenalty =
      charge(partners1, rules.ownPairPenalty, rules.maxCountedPartnerships) + charge(partners2, rules.ownPairPenalty, rules.maxCountedPartnerships)

    const analysis: MatchAnalysis = {
      rivalPairCount: rematch?.times ?? 0,
      individualRivalCount,
      ownPairCount: (partners1?.times ?? 0) + (partners2?.times ?? 0),
      lastPlayedSessions: Number.isFinite(latest) ? latest : -1,
      isRecentlyPlayed: recent,
    }
    // Once per match: in full when anything repeats from the last session, half when the closest is the one before
    const recentPlayPenalty = recent ? rules.recentPlayPenalty : near ? nearPlayPenalty(rules) : 0
    return { analysis, rivalPairPenalty, individualRivalPenalty, ownPairPenalty, recentPlayPenalty }
  }

  /** Analyzes a potential match against historical data. */
  analyzeMatch(team1: [Player, Player], team2: [Player, Player]): MatchAnalysis {
    return this.inspect(team1, team2).analysis
  }

  /** Scores a match suggestion. Lower scores are better. */
  scoreMatch(team1: [Player, Player], team2: [Player, Player]): ScoredSuggestion {
    const { analysis, rivalPairPenalty, individualRivalPenalty, ownPairPenalty, recentPlayPenalty } = this.inspect(team1, team2)

    // Only the gap between the summed levels is used, so it makes no difference
    // whether 1 or 3 is the strongest level: the scale could be flipped without
    // changing any score.
    const skillDifference = Math.abs(team1[0].skill_level + team1[1].skill_level - team2[0].skill_level - team2[1].skill_level)
    const skillScore = skillDifference * this.rules.skillDifferenceWeight

    return {
      team1,
      team2,
      skillDifference,
      recentlyPlayed: analysis.isRecentlyPlayed,
      analysis,
      totalScore: skillScore + rivalPairPenalty + individualRivalPenalty + ownPairPenalty + recentPlayPenalty,
      breakdown: {
        skillScore,
        rivalPairPenalty,
        individualRivalPenalty,
        ownPairPenalty,
        recentPlayPenalty,
      },
    }
  }

  /**
   * Generates and scores all possible match combinations
   */
  generateScoredSuggestions(players: Player[]): ScoredSuggestion[] {
    if (players.length < 4) return []

    const allCombinations: ScoredSuggestion[] = []

    // Generate all possible team combinations
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        for (let k = 0; k < players.length; k++) {
          if (k === i || k === j) continue
          for (let l = k + 1; l < players.length; l++) {
            if (l === i || l === j) continue

            const team1: [Player, Player] = [players[i], players[j]]
            const team2: [Player, Player] = [players[k], players[l]]

            const scoredSuggestion = this.scoreMatch(team1, team2)
            allCombinations.push(scoredSuggestion)
          }
        }
      }
    }

    // Sort by total score (lower is better)
    return allCombinations.sort((a, b) => a.totalScore - b.totalScore)
  }

  /**
   * Returns up to `maxArrangements` complete schedules (every player in exactly
   * one match) for a roster whose size is a multiple of 4.
   *
   * Complete schedules are drawn at random (at most `sampling.maxSamples`),
   * each scored as a whole (sum of its match scores), deduplicated by canonical
   * form, ranked best first, and then chosen so candidates differ from each
   * other. Four players are enumerated outright: there are only 3 team splits.
   * For larger rosters this is a sample, not a proof of optimality.
   */
  generateCompleteArrangements(players: Player[], maxArrangements = this.sampling.maxCandidates): Arrangement[] {
    if (players.length < 4 || players.length % 4 !== 0 || maxArrangements < 1) return []

    const scoreCache = new Map<string, ScoredSuggestion>()
    const unique = new Map<string, Arrangement>()

    if (players.length === 4) {
      for (const split of this.teamSplits(players)) {
        const arrangement = this.assemble([split], scoreCache)
        unique.set(canonicalScheduleKey(arrangement.matches), arrangement)
      }
    } else {
      const spaceSize = scheduleSpaceSize(players.length)
      for (let sample = 0; sample < this.sampling.maxSamples && unique.size < spaceSize; sample++) {
        const arrangement = this.assemble(this.sampleSchedule(players), scoreCache)
        const key = canonicalScheduleKey(arrangement.matches)
        if (!unique.has(key)) unique.set(key, arrangement)
      }
    }

    // Array.prototype.sort is stable, so equal scores keep their (random) sampling order
    const ranked = [...unique.values()].sort((a, b) => a.totalScore - b.totalScore)
    return this.pickDiverse(ranked, maxArrangements, players.length / 4)
  }

  /** Index in [0, count) drawn from the analyzer's RNG. */
  pickIndex(count: number): number {
    return Math.min(count - 1, Math.floor(this.rng() * count))
  }

  /**
   * Shuffles an array in place using Fisher-Yates algorithm
   */
  shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.pickIndex(i + 1)
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }

  /** The 3 distinct ways to split four players into two teams. */
  private teamSplits(four: Player[]): Pairing[] {
    return [
      { team1: [four[0], four[1]], team2: [four[2], four[3]] },
      { team1: [four[0], four[2]], team2: [four[1], four[3]] },
      { team1: [four[0], four[3]], team2: [four[1], four[2]] },
    ]
  }

  /** One random complete schedule: shuffle, cut into foursomes, pick a random team split for each. */
  private sampleSchedule(players: Player[]): Pairing[] {
    const order = [...players]
    this.shuffleArray(order)
    const schedule: Pairing[] = []
    for (let i = 0; i < order.length; i += 4) {
      const splits = this.teamSplits(order.slice(i, i + 4))
      schedule.push(splits[this.pickIndex(3)])
    }
    return schedule
  }

  /** Scores each match in canonical form (cached per call) and totals the whole schedule. */
  private assemble(schedule: Pairing[], cache: Map<string, ScoredSuggestion>): Arrangement {
    const matches = schedule
      .map((pairing) => {
        const key = canonicalMatchKey(pairing)
        let scored = cache.get(key)
        if (!scored) {
          const [first, second] = [pairing.team1, pairing.team2].sort((a, b) => (teamKey(a) < teamKey(b) ? -1 : 1))
          const sortTeam = (t: Team): [Player, Player] => (t[0].id < t[1].id ? [t[0], t[1]] : [t[1], t[0]])
          scored = this.scoreMatch(sortTeam(first), sortTeam(second))
          cache.set(key, scored)
        }
        return { key, scored }
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((m) => m.scored)

    return {
      matches,
      totalScore: matches.reduce((sum, m) => sum + m.totalScore, 0),
      usedPlayers: new Set(matches.flatMap((m) => [...m.team1, ...m.team2].map((p) => p.id))),
    }
  }

  /**
   * Walks the ranked list taking schedules that differ from every pick in at
   * least `minDistinctMatches` matches; if that leaves slots open, fills them
   * with the best remaining (still unique) schedules.
   */
  private pickDiverse(ranked: Arrangement[], limit: number, matchCount: number): Arrangement[] {
    const required = Math.min(this.sampling.minDistinctMatches, matchCount)
    const keysOf = (a: Arrangement) => new Set(a.matches.map(canonicalMatchKey))
    const distance = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)).length

    const chosen: Arrangement[] = []
    const chosenKeys: Set<string>[] = []
    for (const candidate of ranked) {
      if (chosen.length >= limit) break
      const keys = keysOf(candidate)
      if (chosenKeys.every((other) => distance(keys, other) >= required)) {
        chosen.push(candidate)
        chosenKeys.push(keys)
      }
    }
    for (const candidate of ranked) {
      if (chosen.length >= limit) break
      if (!chosen.includes(candidate)) chosen.push(candidate)
    }
    return chosen.sort((a, b) => a.totalScore - b.totalScore)
  }
}
