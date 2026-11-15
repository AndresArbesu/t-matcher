import { z } from "zod"

export type Parsed<T> = { ok: true; value: T } | { ok: false }

export const MAX_PARTICIPANTS = 64
export const MAX_NOTES_LENGTH = 1000

const name = z.string().trim().min(1).max(80)
export const MIN_SKILL = 1
export const MAX_SKILL = 5
const skill = z.number().int().min(MIN_SKILL).max(MAX_SKILL)
const uuid = z.string().uuid()

const playerCreate = z.object({ name, skill_level: skill })
const playerPatch = z
  .object({ name: name.optional(), skill_level: skill.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0)

const team = z.tuple([uuid, uuid])
const draftMatch = z.object({ team1: team, team2: team, locked: z.boolean() })
const sessionDraft = z.object({
  participants: z.array(uuid).max(MAX_PARTICIPANTS),
  matches: z.array(draftMatch).max(MAX_PARTICIPANTS / 4),
})

const matchPatch = z.object({ played: z.boolean(), notes: z.string().trim().max(MAX_NOTES_LENGTH).optional() })

export type PlayerCreate = z.infer<typeof playerCreate>
export type PlayerPatch = z.infer<typeof playerPatch>
export type DraftMatchInput = z.infer<typeof draftMatch>
export type SessionDraftInput = z.infer<typeof sessionDraft>
export type MatchPatch = z.infer<typeof matchPatch>

function parse<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  const result = schema.safeParse(body)
  return result.success ? { ok: true, value: result.data } : { ok: false }
}

export const parsePlayerCreate = (body: unknown) => parse(playerCreate, body)
export const parsePlayerPatch = (body: unknown) => parse(playerPatch, body)
export const parseMatchPatch = (body: unknown) => parse(matchPatch, body)

export function parseSessionDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

export function parseUuid(value: unknown): string | null {
  return uuid.safeParse(value).success ? (value as string) : null
}

/** Structural checks only; ownership of the IDs is verified against the database by the route. */
export function parseSessionDraft(body: unknown): Parsed<SessionDraftInput> {
  const parsed = parse(sessionDraft, body)
  if (!parsed.ok) return parsed
  const { participants, matches } = parsed.value
  const participantSet = new Set(participants)
  if (participantSet.size !== participants.length) return { ok: false }

  const used = new Set<string>()
  for (const match of matches) {
    const ids = [...match.team1, ...match.team2]
    for (const id of ids) {
      if (!participantSet.has(id) || used.has(id)) return { ok: false }
      used.add(id)
    }
  }
  return parsed
}
