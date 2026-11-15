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

  constructor(matchHistory: MatchHistory[], players: Player[]) {
    this.matchHistory = matchHistory
    this.players = players
  }

  /**
   * Analyzes a potential match against historical data
   */
  analyzeMatch(team1: [Player, Player], team2: [Player, Player]): MatchAnalysis {
    const allPlayers = [...team1, ...team2]
    const team1Ids = team1.map((p) => p.id).sort()
    const team2Ids = team2.map((p) => p.id).sort()

    let rivalPairCount = 0
    let individualRivalCount = 0
    let ownPairCount = 0
    let lastPlayedDays = Number.POSITIVE_INFINITY

    for (const match of this.matchHistory) {
      const matchDate = new Date(match.played_at)
      const daysAgo = (Date.now() - matchDate.getTime()) / (1000 * 60 * 60 * 24)

      // Get teams from historical match
      const historicalTeam1 = [match.team1_player1_id, match.team1_player2_id].sort()
      const historicalTeam2 = [match.team2_player1_id, match.team2_player2_id].sort()

      // Check if exact rival pairs match
      const rivalPair1Matches =
        this.arraysEqual(team1Ids, historicalTeam2) && this.arraysEqual(team2Ids, historicalTeam1)
      const rivalPair2Matches =
        this.arraysEqual(team1Ids, historicalTeam1) && this.arraysEqual(team2Ids, historicalTeam2)

      if (rivalPair1Matches || rivalPair2Matches) {
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

      // Check individual rival encounters
      const matchPlayers = [match.player1_id, match.player2_id, match.player3_id, match.player4_id]
      const hasAllPlayers = allPlayers.every((p) => matchPlayers.includes(p.id))

      if (hasAllPlayers) {
        individualRivalCount++
        lastPlayedDays = Math.min(lastPlayedDays, daysAgo)
      }
    }

    return {
      rivalPairCount,
      individualRivalCount,
      ownPairCount,
      lastPlayedDays: lastPlayedDays === Number.POSITIVE_INFINITY ? -1 : lastPlayedDays,
      isRecentlyPlayed: lastPlayedDays <= 7, // Within last week
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
    const skillScore = skillDifference * 10 // Base score from skill difference

    // Penalties for repetition (higher penalties for more recent matches)
    const recentMultiplier = analysis.isRecentlyPlayed ? 3 : 1

    const rivalPairPenalty = analysis.rivalPairCount * 1000 * recentMultiplier // Rule 2: Highest penalty
    const individualRivalPenalty = analysis.individualRivalCount * 500 * recentMultiplier // Rule 3
    const ownPairPenalty = analysis.ownPairCount * 300 * recentMultiplier // Rule 4
    const recentPlayPenalty = analysis.isRecentlyPlayed ? 2000 : 0 // Extra penalty for recent play

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
   * Generates complete arrangements where all players are assigned to matches
   * Used when player count is a multiple of 4 (8, 12, 16, 20, etc.)
   */
  generateCompleteArrangements(players: Player[], maxArrangements = 5): Arrangement[] {
    if (players.length < 4 || players.length % 4 !== 0) return []

    const numMatches = players.length / 4
    const arrangements: Arrangement[] = []

    // Generate multiple different arrangements
    for (let attempt = 0; attempt < maxArrangements * 10 && arrangements.length < maxArrangements; attempt++) {
      const arrangement = this.generateSingleArrangement(players, numMatches)
      if (arrangement && !this.isDuplicateArrangement(arrangement, arrangements)) {
        arrangements.push(arrangement)
      }
    }

    // Sort arrangements by total score (lower is better)
    return arrangements.sort((a, b) => a.totalScore - b.totalScore)
  }

  /**
   * Generates an arrangement with some matches fixed and remaining players shuffled
   */
  generateArrangementWithFixedMatches(remainingPlayers: Player[], fixedMatches: ScoredSuggestion[]): Arrangement {
    const numRemainingMatches = remainingPlayers.length / 4
    const newMatches: ScoredSuggestion[] = []
    const usedPlayers = new Set<string>()

    // Add fixed matches first
    fixedMatches.forEach((match) => {
      newMatches.push(match)
      match.team1.forEach((p) => usedPlayers.add(p.id))
      match.team2.forEach((p) => usedPlayers.add(p.id))
    })

    // Generate matches for remaining players
    const availablePlayers = [...remainingPlayers]
    this.shuffleArray(availablePlayers)

    for (let matchIndex = 0; matchIndex < numRemainingMatches; matchIndex++) {
      const playersLeft = availablePlayers.filter((p) => !usedPlayers.has(p.id))

      if (playersLeft.length < 4) break

      // Generate all possible matches from remaining players
      const possibleMatches: ScoredSuggestion[] = []

      for (let i = 0; i < playersLeft.length; i++) {
        for (let j = i + 1; j < playersLeft.length; j++) {
          for (let k = 0; k < playersLeft.length; k++) {
            if (k === i || k === j) continue
            for (let l = k + 1; l < playersLeft.length; l++) {
              if (l === i || l === j) continue

              const team1: [Player, Player] = [playersLeft[i], playersLeft[j]]
              const team2: [Player, Player] = [playersLeft[k], playersLeft[l]]

              const scoredMatch = this.scoreMatch(team1, team2)
              possibleMatches.push(scoredMatch)
            }
          }
        }
      }

      // Sort by score and pick the best available match
      possibleMatches.sort((a, b) => a.totalScore - b.totalScore)

      const bestMatch = possibleMatches[0]
      if (!bestMatch) break

      newMatches.push(bestMatch)

      // Mark players as used
      bestMatch.team1.forEach((p) => usedPlayers.add(p.id))
      bestMatch.team2.forEach((p) => usedPlayers.add(p.id))
    }

    const totalScore = newMatches.reduce((sum, match) => sum + match.totalScore, 0)

    return {
      matches: newMatches,
      totalScore,
      usedPlayers,
    }
  }

  /**
   * Generates a single arrangement with all players assigned to matches
   */
  private generateSingleArrangement(players: Player[], numMatches: number): Arrangement | null {
    const availablePlayers = [...players]
    const matches: ScoredSuggestion[] = []
    const usedPlayers = new Set<string>()

    // Shuffle players for variety in arrangements
    this.shuffleArray(availablePlayers)

    for (let matchIndex = 0; matchIndex < numMatches; matchIndex++) {
      const remainingPlayers = availablePlayers.filter((p) => !usedPlayers.has(p.id))

      if (remainingPlayers.length < 4) return null

      // Generate all possible matches from remaining players
      const possibleMatches: ScoredSuggestion[] = []

      for (let i = 0; i < remainingPlayers.length; i++) {
        for (let j = i + 1; j < remainingPlayers.length; j++) {
          for (let k = 0; k < remainingPlayers.length; k++) {
            if (k === i || k === j) continue
            for (let l = k + 1; l < remainingPlayers.length; l++) {
              if (l === i || l === j) continue

              const team1: [Player, Player] = [remainingPlayers[i], remainingPlayers[j]]
              const team2: [Player, Player] = [remainingPlayers[k], remainingPlayers[l]]

              const scoredMatch = this.scoreMatch(team1, team2)
              possibleMatches.push(scoredMatch)
            }
          }
        }
      }

      // Sort by score and pick the best available match
      possibleMatches.sort((a, b) => a.totalScore - b.totalScore)

      const bestMatch = possibleMatches[0]
      if (!bestMatch) return null

      matches.push(bestMatch)

      // Mark players as used
      bestMatch.team1.forEach((p) => usedPlayers.add(p.id))
      bestMatch.team2.forEach((p) => usedPlayers.add(p.id))
    }

    const totalScore = matches.reduce((sum, match) => sum + match.totalScore, 0)

    return {
      matches,
      totalScore,
      usedPlayers,
    }
  }

  /**
   * Checks if an arrangement is a duplicate of existing ones
   */
  private isDuplicateArrangement(newArrangement: Arrangement, existingArrangements: Arrangement[]): boolean {
    return existingArrangements.some((existing) => {
      if (existing.matches.length !== newArrangement.matches.length) return false

      // Check if all matches are the same (order doesn't matter)
      return newArrangement.matches.every((newMatch) => {
        return existing.matches.some((existingMatch) => {
          const newPlayers = [...newMatch.team1, ...newMatch.team2].map((p) => p.id).sort()
          const existingPlayers = [...existingMatch.team1, ...existingMatch.team2].map((p) => p.id).sort()
          return this.arraysEqual(newPlayers, existingPlayers)
        })
      })
    })
  }

  /**
   * Shuffles an array in place using Fisher-Yates algorithm
   */
  shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i])
  }
}
