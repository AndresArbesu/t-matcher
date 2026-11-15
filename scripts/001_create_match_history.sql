-- Create players table to store player information
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  skill_level INTEGER NOT NULL CHECK (skill_level >= 1 AND skill_level <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create match_history table to store completed matches
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player1_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player2_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player3_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player4_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team1_player1_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team1_player2_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team2_player1_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team2_player2_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  played_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure all 4 players are different
  CONSTRAINT different_players CHECK (
    player1_id != player2_id AND
    player1_id != player3_id AND
    player1_id != player4_id AND
    player2_id != player3_id AND
    player2_id != player4_id AND
    player3_id != player4_id
  ),

  -- Ensure team assignments are consistent with player list
  CONSTRAINT valid_team_assignments CHECK (
    team1_player1_id IN (player1_id, player2_id, player3_id, player4_id) AND
    team1_player2_id IN (player1_id, player2_id, player3_id, player4_id) AND
    team2_player1_id IN (player1_id, player2_id, player3_id, player4_id) AND
    team2_player2_id IN (player1_id, player2_id, player3_id, player4_id) AND
    team1_player1_id != team1_player2_id AND
    team2_player1_id != team2_player2_id
  )
);

-- Enable Row Level Security (RLS) for data protection
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since this is a single-user tennis scheduler)
-- In a multi-user app, you would restrict these to specific users
CREATE POLICY "Allow public access to players" ON players FOR ALL USING (true);
CREATE POLICY "Allow public access to match_history" ON match_history FOR ALL USING (true);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_match_history_played_at ON match_history(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_players ON match_history(player1_id, player2_id, player3_id, player4_id);
CREATE INDEX IF NOT EXISTS idx_match_history_teams ON match_history(team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id);
