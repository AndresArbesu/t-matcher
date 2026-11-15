export interface Player {
  id: string
  name: string
  skill_level: number
  created_at?: string
}

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
  notes?: string
  created_at: string
}

export interface MatchSuggestion {
  team1: [Player, Player]
  team2: [Player, Player]
  skillDifference: number
  recentlyPlayed: boolean
}

export interface MatchHistoryWithPlayers extends MatchHistory {
  players: Player[]
  team1: [Player, Player]
  team2: [Player, Player]
}
