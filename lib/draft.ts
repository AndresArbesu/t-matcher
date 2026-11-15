import { canonicalScheduleKey, type MatchAnalyzer, type ScoredSuggestion } from "./match-analyzer"
import type { Player, SavedMatch } from "./types"
import type { SessionDraftInput } from "./validation"

/** A suggested match plus whether the organizer pinned it in place. */
export type DraftMatch = ScoredSuggestion & { locked: boolean }

export function withLocks(matches: ScoredSuggestion[]): DraftMatch[] {
  return matches.map((m) => ({ ...m, locked: false }))
}

/** How many ranked, diverse remainders to consider; one extra so excluding the current one still leaves a full set. */
const REGENERATE_CANDIDATES = 4

/**
 * Re-pairs everyone who is not in a locked match. Locked matches keep their
 * slot untouched; the open slots are refilled with the best-ranked complete
 * remainder (sampled and scored as a whole) that differs from what the open
 * slots hold now. If no different remainder exists the best one is returned.
 */
export function regenerateUnlocked(analyzer: MatchAnalyzer, participants: Player[], draft: DraftMatch[]): DraftMatch[] {
  const lockedIds = new Set(draft.filter((m) => m.locked).flatMap((m) => [...m.team1, ...m.team2].map((p) => p.id)))
  const free = participants.filter((p) => !lockedIds.has(p.id))
  const open = draft.filter((m) => !m.locked)
  if (open.length === 0) return draft
  if (free.length !== open.length * 4) throw new Error("Participants no longer match the draft; generate again")

  const candidates = analyzer.generateCompleteArrangements(free, REGENERATE_CANDIDATES)
  if (candidates.length === 0) throw new Error("Could not form a match from the remaining players")

  const currentKey = canonicalScheduleKey(open)
  const chosen = candidates.find((c) => canonicalScheduleKey(c.matches) !== currentKey) ?? candidates[0]

  let next = 0
  return draft.map((m) => (m.locked ? m : { ...chosen.matches[next++], locked: false }))
}

/** Rebuilds scored matches from saved rows. Played matches are history, not part of the draft. */
export function hydrateDraft(saved: SavedMatch[], players: Map<string, Player>, analyzer: MatchAnalyzer): DraftMatch[] {
  const lookup = (id: string) => {
    const player = players.get(id)
    if (!player) throw new Error(`Unknown player in saved session: ${id}`)
    return player
  }
  return saved
    .filter((m) => !m.played)
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      ...analyzer.scoreMatch([lookup(m.team1[0]), lookup(m.team1[1])], [lookup(m.team2[0]), lookup(m.team2[1])]),
      locked: m.locked,
    }))
}

export function toDraftPayload(participantIds: string[], draft: DraftMatch[]): SessionDraftInput {
  return {
    participants: participantIds,
    matches: draft.map((m) => ({
      team1: [m.team1[0].id, m.team1[1].id],
      team2: [m.team2[0].id, m.team2[1].id],
      locked: m.locked,
    })),
  }
}
