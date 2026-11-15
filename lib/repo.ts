import type { SupabaseClient } from "@supabase/supabase-js"
import { toMatchHistory, type PlayedMatchRow } from "./history"
import type { MatchHistory, Player, SavedMatch, SavedSession } from "./types"
import type { MatchPatch, PlayerCreate, PlayerPatch, SessionDraftInput } from "./validation"

/**
 * All database access. Every call runs as the signed-in user through the anon key,
 * so Row Level Security scopes it to their rows; errors are thrown untouched and
 * converted to safe responses by `toErrorResponse`.
 */

const PLAYER_COLUMNS = "id, name, skill_level, active, created_at"
const MATCH_COLUMNS =
  "id, session_id, position, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, locked, played, notes, created_at"

type MatchRow = PlayedMatchRow & { session_id: string; position: number; locked: boolean; played: boolean }

function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

export async function listPlayers(supabase: SupabaseClient): Promise<Player[]> {
  return check(await supabase.from("players").select(PLAYER_COLUMNS).order("name")) as Player[]
}

export async function createPlayer(supabase: SupabaseClient, input: PlayerCreate): Promise<Player> {
  return check(await supabase.from("players").insert(input).select(PLAYER_COLUMNS).single()) as Player
}

/** Returns null when the player does not exist or belongs to someone else. */
export async function updatePlayer(supabase: SupabaseClient, id: string, patch: PlayerPatch): Promise<Player | null> {
  return check(await supabase.from("players").update(patch).eq("id", id).select(PLAYER_COLUMNS).maybeSingle()) as Player | null
}

export async function countOwnedPlayers(supabase: SupabaseClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const rows = check(await supabase.from("players").select("id").in("id", ids)) as { id: string }[]
  return rows.length
}

export async function getSession(supabase: SupabaseClient, date: string): Promise<SavedSession | null> {
  const session = check(await supabase.from("sessions").select("id").eq("session_date", date).maybeSingle()) as {
    id: string
  } | null
  if (!session) return null

  const [participants, matches] = await Promise.all([
    supabase.from("session_players").select("player_id").eq("session_id", session.id),
    supabase.from("session_matches").select(MATCH_COLUMNS).eq("session_id", session.id).order("position"),
  ])
  return {
    date,
    participants: (check(participants) as { player_id: string }[]).map((r) => r.player_id),
    matches: (check(matches) as MatchRow[]).map(toSavedMatch),
  }
}

export async function saveSessionDraft(supabase: SupabaseClient, date: string, draft: SessionDraftInput): Promise<void> {
  check(
    await supabase.rpc("save_session_draft", {
      p_date: date,
      p_participants: draft.participants,
      p_matches: draft.matches,
    }),
  )
}

/** Returns null when the match does not exist or belongs to someone else. */
export async function setMatchPlayed(supabase: SupabaseClient, id: string, patch: MatchPatch): Promise<SavedMatch | null> {
  const row = check(
    await supabase.from("session_matches").update(patch).eq("id", id).select(MATCH_COLUMNS).maybeSingle(),
  ) as MatchRow | null
  return row ? toSavedMatch(row) : null
}

export async function listHistory(supabase: SupabaseClient): Promise<MatchHistory[]> {
  const played = check(
    await supabase.from("session_matches").select(MATCH_COLUMNS).eq("played", true),
  ) as MatchRow[]
  if (played.length === 0) return []
  const sessions = check(await supabase.from("sessions").select("id, session_date")) as { id: string; session_date: string }[]
  const dateById = new Map(sessions.map((s) => [s.id, s.session_date]))
  return played
    .filter((m) => dateById.has(m.session_id))
    .map((m) => toMatchHistory(m, dateById.get(m.session_id)!))
    .sort((a, b) => b.played_at.localeCompare(a.played_at))
}

function toSavedMatch(row: MatchRow): SavedMatch {
  return {
    id: row.id,
    position: row.position,
    team1: [row.team1_player1_id, row.team1_player2_id],
    team2: [row.team2_player1_id, row.team2_player2_id],
    locked: row.locked,
    played: row.played,
    notes: row.notes,
  }
}
