import type { Player, MatchHistory, MatchSuggestion } from "./types"

export interface MatchAnalysis {
  rivalPairCount: number
  individualRivalCount: number
  ownPairCount: number
  lastPlayedDays: number
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
 */
export interface ScoringRules {
  /** Points per skill point of difference between the two teams' summed skill. */
  skillDifferenceWeight: number
  /** Per earlier match with exactly the same two teams facing each other. */
  rivalPairPenalty: number
  /** Per opposing player pair that also stood on opposite sides in an earlier match. */
  individualRivalPenalty: number
  /** Per earlier match in which either current team was already a team. */
  ownPairPenalty: number
  /** A repeat counts as "recent" when the latest one was at most this many days ago. */
  recentWindowDays: number
  /** Multiplier applied to the three repeat penalties above when the repeat is recent. */
  recentMultiplier: number
  /** Flat extra penalty when any repeat is recent. */
  recentPlayPenalty: number
}

export const DEFAULT_RULES: ScoringRules = {
  skillDifferenceWeight: 10,
  rivalPairPenalty: 1000,
  individualRivalPenalty: 500,
  ownPairPenalty: 300,
  recentWindowDays: 7,
  recentMultiplier: 3,
  recentPlayPenalty: 2000,
}

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
  maxSamples: 400,
  maxCandidates: 3,
  minDistinctMatches: 2,
}

export interface MatchAnalyzerOptions {
  rules?: ScoringRules
  sampling?: Partial<SamplingLimits>
  /** Source of randomness in [0, 1); inject a seeded one in tests. */
  rng?: () => number
  /** Clock in epoch milliseconds; inject a fixed one in tests. */
  now?: () => number
}

type Team = readonly [Player, Player]
type Pairing = { team1: Team; team2: Team }

const teamKey = (team: Team) => (team[0].id < team[1].id ? `${team[0].id}+${team[1].id}` : `${team[1].id}+${team[0].id}`)

/** One key for a match regardless of player order inside teams or which team is listed first. */
export function canonicalMatchKey(match: Pairing): string {
  const a = teamKey(match.team1)
  const b = teamKey(match.team2)
  return a < b ? `${a}|${b}` : `${b}|${a}`
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
 * Analyzes match history to score suggestions based on user's rules:
 * 1. Least skill difference (lower is better)
 * 2. No repeated rival pairs
 * 3. No repeated individual rivals
 * 4. No repeated own pairs
 * Priority: Recent matches (last week) get higher penalty
 */
export class MatchAnalyzer {
  private matchHistory: MatchHistory[]
  private players: Player[]
  private rules: ScoringRules
  private sampling: SamplingLimits
  private rng: () => number
  private now: () => number

  constructor(matchHistory: MatchHistory[], players: Player[], options: MatchAnalyzerOptions = {}) {
    this.matchHistory = matchHistory
    this.players = players
    this.rules = options.rules ?? DEFAULT_RULES
    this.sampling = { ...DEFAULT_SAMPLING, ...options.sampling }
    this.rng = options.rng ?? Math.random
    this.now = options.now ?? Date.now
  }

  /**
   * Analyzes a potential match against historical data.
   *
   * An individual rival encounter is an opposing player pair (one from each
   * team) that also stood on opposite sides in an earlier match. Pairs that
   * were partners before do not count, and an exact team rematch is counted
   * only as a rival pair so the same meeting is never penalised twice.
   */
  analyzeMatch(team1: [Player, Player], team2: [Player, Player]): MatchAnalysis {
    const team1Ids = team1.map((p) => p.id).sort()
    const team2Ids = team2.map((p) => p.id).sort()

    let rivalPairCount = 0
    let individualRivalCount = 0
    let ownPairCount = 0
    let lastPlayedDays = Number.POSITIVE_INFINITY

    for (const match of this.matchHistory) {
      const daysAgo = (this.now() - new Date(match.played_at).getTime()) / (1000 * 60 * 60 * 24)

      // Get teams from historical match
      const historicalTeam1 = [match.team1_player1_id, match.team1_player2_id].sort()
      const historicalTeam2 = [match.team2_player1_id, match.team2_player2_id].sort()

      // Check if exact rival pairs match
      const exactRematch =
        (this.arraysEqual(team1Ids, historicalTeam2) && this.arraysEqual(team2Ids, historicalTeam1)) ||
        (this.arraysEqual(team1Ids, historicalTeam1) && this.arraysEqual(team2Ids, historicalTeam2))

      if (exactRematch) {
        rivalPairCount++
        lastPlayedDays = Math.min(lastPlayedDays, daysAgo)
      }

      // Check if own pairs match
      const ownPair1Matches = this.arraysEqual(team1Ids, historicalTeam1) || this.arraysEqual(team1Ids, historicalTeam2)
      const ownPair2Matches = this.arraysEqual(team2Ids, historicalTeam1) || this.arraysEqual(team2Ids, historicalTeam2)

      if (ownPair1Matches || ownPair2Matches) {
        ownPairCount++
        lastPlayedDays = Math.min(lastPlayedDays, daysAgo)
      }

      // Individual rivals: opposing pairs that were also opposed before (never former partners)
      if (!exactRematch) {
        let opposedBefore = 0
        for (const a of team1Ids) {
          for (const b of team2Ids) {
            const opposed =
              (historicalTeam1.includes(a) && historicalTeam2.includes(b)) ||
              (historicalTeam2.includes(a) && historicalTeam1.includes(b))
            if (opposed) opposedBefore++
          }
        }
        if (opposedBefore > 0) {
          individualRivalCount += opposedBefore
          lastPlayedDays = Math.min(lastPlayedDays, daysAgo)
        }
      }
    }

    return {
      rivalPairCount,
      individualRivalCount,
      ownPairCount,
      lastPlayedDays: lastPlayedDays === Number.POSITIVE_INFINITY ? -1 : lastPlayedDays,
      isRecentlyPlayed: lastPlayedDays <= this.rules.recentWindowDays,
    }
  }

  /**
   * Scores a match suggestion based on the analysis
   * Lower scores are better (higher priority)
   */
  scoreMatch(team1: [Player, Player], team2: [Player, Player]): ScoredSuggestion {
    const analysis = this.analyzeMatch(team1, team2)

    // Calculate skill difference (Rule 1: Suma menor puntos de DIF de habilidad)
    const team1Skill = team1[0].skill_level + team1[1].skill_level
    const team2Skill = team2[0].skill_level + team2[1].skill_level
    const skillDifference = Math.abs(team1Skill - team2Skill)

    // Scoring system (lower is better)
    const { rules } = this
    const skillScore = skillDifference * rules.skillDifferenceWeight // Base score from skill difference

    // Penalties for repetition (higher penalties for more recent matches)
    const recentMultiplier = analysis.isRecentlyPlayed ? rules.recentMultiplier : 1

    const rivalPairPenalty = analysis.rivalPairCount * rules.rivalPairPenalty * recentMultiplier // Rule 2: Highest penalty
    const individualRivalPenalty = analysis.individualRivalCount * rules.individualRivalPenalty * recentMultiplier // Rule 3
    const ownPairPenalty = analysis.ownPairCount * rules.ownPairPenalty * recentMultiplier // Rule 4
    const recentPlayPenalty = analysis.isRecentlyPlayed ? rules.recentPlayPenalty : 0 // Extra penalty for recent play

    const totalScore = skillScore + rivalPairPenalty + individualRivalPenalty + ownPairPenalty + recentPlayPenalty

    return {
      team1,
      team2,
      skillDifference,
      recentlyPlayed: analysis.isRecentlyPlayed,
      analysis,
      totalScore,
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

  private arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i])
  }
}
