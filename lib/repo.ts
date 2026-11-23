import { ApiError } from "./api/errors"
import { toMatchHistory } from "./history"
import { mutate, type Doc, type DocStore, type StoredMatch } from "./store"
import type { MatchHistory, Player, SavedMatch, SavedSession } from "./types"
import type { HistoricalMatchInput, MatchPatch, PlayerCreate, PlayerPatch, SessionDraftInput } from "./validation"

/**
 * All data access, over the single JSON document. The rules the old SQL schema
 * enforced live here: unique player names, players never deleted, played matches
 * kept, a participant of a played match cannot be removed.
 */

const nameKey = (name: string) => name.trim().toLowerCase()

function toSavedMatch(match: StoredMatch): SavedMatch {
  return {
    id: match.id,
    position: match.position,
    team1: match.team1,
    team2: match.team2,
    locked: match.locked,
    played: match.played,
    notes: match.notes,
  }
}

function findMatch(doc: Doc, id: string): { match: StoredMatch; date: string } | null {
  for (const [date, session] of Object.entries(doc.sessions)) {
    const match = session.matches.find((m) => m.id === id)
    if (match) return { match, date }
  }
  return null
}

export async function listPlayers(store: DocStore): Promise<Player[]> {
  const { doc } = await store.read()
  return [...doc.players].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

export async function createPlayer(store: DocStore, input: PlayerCreate): Promise<Player> {
  return mutate(store, (doc) => {
    const name = input.name.trim()
    if (doc.players.some((p) => nameKey(p.name) === nameKey(name))) throw new ApiError(409, "conflict")
    const player: Player = {
      id: crypto.randomUUID(),
      name,
      skill_level: input.skill_level,
      active: true,
      created_at: new Date().toISOString(),
    }
    doc.players.push(player)
    return player
  })
}

/** Returns null when the player does not exist. */
export async function updatePlayer(store: DocStore, id: string, patch: PlayerPatch): Promise<Player | null> {
  return mutate(store, (doc) => {
    const player = doc.players.find((p) => p.id === id)
    if (!player) return null
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (doc.players.some((p) => p.id !== id && nameKey(p.name) === nameKey(name))) throw new ApiError(409, "conflict")
      player.name = name
    }
    if (patch.skill_level !== undefined) player.skill_level = patch.skill_level
    if (patch.active !== undefined) player.active = patch.active
    return { ...player }
  })
}

export async function getSession(store: DocStore, date: string): Promise<SavedSession | null> {
  const { doc } = await store.read()
  return toSavedSession(doc, date)
}

function toSavedSession(doc: Doc, date: string): SavedSession | null {
  const session = doc.sessions[date]
  if (!session) return null
  return {
    date,
    participants: [...session.participants],
    matches: [...session.matches].sort((a, b) => a.position - b.position).map(toSavedMatch),
  }
}

/**
 * Replaces the participant list and the unplayed matches of a date; played matches are history and stay.
 * New matches are appended after the highest kept position.
 */
export async function saveSessionDraft(store: DocStore, date: string, draft: SessionDraftInput): Promise<SavedSession> {
  return mutate(store, (doc) => {
    const known = new Set(doc.players.map((p) => p.id))
    if (!draft.participants.every((id) => known.has(id))) throw new ApiError(422, "invalid_players")

    const participants = new Set(draft.participants)
    for (const match of draft.matches) {
      const ids = [...match.team1, ...match.team2]
      if (new Set(ids).size !== 4 || !ids.every((id) => participants.has(id))) throw new ApiError(400, "invalid_request")
    }

    const kept = (doc.sessions[date]?.matches ?? []).filter((m) => m.played)
    for (const match of kept) {
      if (![...match.team1, ...match.team2].every((id) => participants.has(id))) throw new ApiError(409, "in_use")
    }

    const base = kept.reduce((max, m) => Math.max(max, m.position + 1), 0)
    const now = new Date().toISOString()
    const added: StoredMatch[] = draft.matches.map((m, i) => ({
      id: crypto.randomUUID(),
      position: base + i,
      team1: [m.team1[0], m.team1[1]],
      team2: [m.team2[0], m.team2[1]],
      locked: m.locked,
      played: false,
      notes: null,
      created_at: now,
    }))
    doc.sessions[date] = { participants: [...draft.participants], matches: [...kept, ...added], updated_at: now }
    return toSavedSession(doc, date)!
  })
}

/** Returns null when the match does not exist. Notes are cleared when none are supplied. */
export async function setMatchPlayed(store: DocStore, id: string, patch: MatchPatch): Promise<SavedMatch | null> {
  return mutate(store, (doc) => {
    const found = findMatch(doc, id)
    if (!found) return null
    found.match.played = patch.played
    found.match.notes = patch.notes ?? null
    return toSavedMatch(found.match)
  })
}

export async function listHistory(store: DocStore): Promise<MatchHistory[]> {
  const { doc } = await store.read()
  const rows: { history: MatchHistory; position: number }[] = []
  for (const [date, session] of Object.entries(doc.sessions)) {
    for (const match of session.matches) {
      if (!match.played) continue
      rows.push({
        history: toMatchHistory(
          {
            id: match.id,
            notes: match.notes,
            created_at: match.created_at,
            team1_player1_id: match.team1[0],
            team1_player2_id: match.team1[1],
            team2_player1_id: match.team2[0],
            team2_player2_id: match.team2[1],
          },
          date,
        ),
        position: match.position,
      })
    }
  }
  // Newest session first; within a day the later match first.
  rows.sort((a, b) => b.history.played_at.localeCompare(a.history.played_at) || b.position - a.position)
  return rows.map((r) => r.history)
}

export async function addHistoricalMatch(store: DocStore, input: HistoricalMatchInput): Promise<MatchHistory> {
  return mutate(store, (doc) => {
    const ids = [...input.team1, ...input.team2]
    if (!ids.every((id) => doc.players.some((p) => p.id === id))) throw new ApiError(422, "invalid_players")
    const now = new Date().toISOString()
    const session = doc.sessions[input.date] ?? { participants: [], matches: [], updated_at: now }
    const match: StoredMatch = {
      id: crypto.randomUUID(), position: session.matches.reduce((max, m) => Math.max(max, m.position + 1), 0),
      team1: input.team1, team2: input.team2, played: true, locked: false, notes: null, created_at: now,
    }
    session.participants = [...new Set([...session.participants, ...ids])]
    session.matches.push(match)
    session.updated_at = now
    doc.sessions[input.date] = session
    return toMatchHistory({ id: match.id, notes: match.notes, created_at: match.created_at,
      team1_player1_id: match.team1[0], team1_player2_id: match.team1[1],
      team2_player1_id: match.team2[0], team2_player2_id: match.team2[1] }, input.date)
  })
}
