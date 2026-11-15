import { ApiError } from "./api/errors"
import type { Player, SavedMatch } from "./types"

/** A match as persisted: the saved shape plus the time it was created (history needs it). */
export type StoredMatch = SavedMatch & { created_at: string }

export interface StoredSession {
  participants: string[]
  matches: StoredMatch[]
  updated_at: string
}

/** The whole application state: one JSON document, versioned so it can be migrated later. */
export interface Doc {
  version: 1
  players: Player[]
  /** Keyed by "YYYY-MM-DD". */
  sessions: Record<string, StoredSession>
  meta: { lastSnapshot?: string }
}

export const emptyDoc = (): Doc => ({ version: 1, players: [], sessions: {}, meta: {} })

/** Throws when `value` is not a document this code understands (never guesses at an unknown version). */
export function parseDoc(value: unknown): Doc {
  const doc = value as Partial<Doc> | null
  if (!doc || typeof doc !== "object" || doc.version !== 1 || !Array.isArray(doc.players) || !doc.sessions || typeof doc.sessions !== "object") {
    throw new Error("Unsupported document")
  }
  return { version: 1, players: doc.players, sessions: doc.sessions, meta: doc.meta ?? {} }
}

/** Thrown by `write` when the etag no longer matches (or a first write finds the document already there). */
export class StoreConflictError extends Error {
  constructor() {
    super("store conflict")
    this.name = "StoreConflictError"
  }
}

export interface DocStore {
  /** An absent document reads as an empty one with a null etag. */
  read(): Promise<{ doc: Doc; etag: string | null }>
  /** Writes only if the stored etag still equals `etag` (null = nothing may exist yet). Returns the new etag. */
  write(doc: Doc, etag: string | null): Promise<string>
}

export const MAX_ATTEMPTS = 6

const pause = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 40))

/**
 * Read, apply `fn` (may mutate the document and may throw an ApiError), write with the etag.
 * On an etag conflict the document is re-read and `fn` runs again, up to 6 attempts, pausing briefly between tries.
 * Nothing is written when `fn` left the document unchanged.
 */
export async function mutate<T>(store: DocStore, fn: (doc: Doc) => T): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { doc, etag } = await store.read()
    const before = JSON.stringify(doc)
    const result = fn(doc)
    if (JSON.stringify(doc) === before) return result
    try {
      await store.write(doc, etag)
      return result
    } catch (error) {
      if (!(error instanceof StoreConflictError)) throw error
      if (attempt < MAX_ATTEMPTS - 1) await pause(attempt)
    }
  }
  throw new ApiError(409, "conflict")
}
