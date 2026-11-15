import type { MatchHistory } from "./types"

export interface PlayedMatchRow {
  id: string
  notes: string | null
  created_at: string
  team1_player1_id: string
  team1_player2_id: string
  team2_player1_id: string
  team2_player2_id: string
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 1000 * 60 * 60 * 24

/**
 * Formats a stored session date. A date-only string names a calendar day, so it
 * is shown as that exact day in every timezone; full timestamps keep their time.
 */
export function formatPlayedAt(playedAt: string, locale: string): string {
  const parts = DATE_ONLY.exec(playedAt)
  if (parts) {
    const day = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
    return day.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
  }
  return new Date(playedAt).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Whole calendar days from a stored session date to today (local calendar for date-only values). */
export function daysSince(playedAt: string, now: Date = new Date()): number {
  const parts = DATE_ONLY.exec(playedAt)
  if (parts) {
    const played = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.floor((today - played) / DAY_MS)
  }
  return Math.floor((now.getTime() - new Date(playedAt).getTime()) / DAY_MS)
}

/** Adapts a played session match to the history shape used by `MatchAnalyzer`. */
export function toMatchHistory(row: PlayedMatchRow, sessionDate: string): MatchHistory {
  return {
    id: row.id,
    player1_id: row.team1_player1_id,
    player2_id: row.team1_player2_id,
    player3_id: row.team2_player1_id,
    player4_id: row.team2_player2_id,
    team1_player1_id: row.team1_player1_id,
    team1_player2_id: row.team1_player2_id,
    team2_player1_id: row.team2_player1_id,
    team2_player2_id: row.team2_player2_id,
    played_at: sessionDate,
    notes: row.notes,
    created_at: row.created_at,
  }
}
