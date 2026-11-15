export interface Player {
  id: string
  name: string
  skill_level: number
  /** Soft-delete flag: inactive players are hidden from the roster but kept for history. */
  active: boolean
  created_at?: string
}

/** A played match in the shape the scoring code consumes. `played_at` is the session date. */
export interface MatchHistory {
  id: string
  player1_id: string
  player2_id: string
  player3_id: string
  player4_id: string
  team1_player1_id: string
  team1_player2_id: string
  team2_player1_id: string
  team2_player2_id: string
  played_at: string
  notes?: string | null
  created_at: string
}

export interface MatchSuggestion {
  team1: [Player, Player]
  team2: [Player, Player]
  skillDifference: number
  recentlyPlayed: boolean
}

/** A match as stored on a dated session. */
export interface SavedMatch {
  id: string
  position: number
  team1: [string, string]
  team2: [string, string]
  locked: boolean
  played: boolean
  notes: string | null
}

export interface SavedSession {
  date: string
  participants: string[]
  matches: SavedMatch[]
}
