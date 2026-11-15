import type { MatchHistory, Player, SavedMatch, SavedSession } from "./types"
import type { MatchPatch, PlayerCreate, SessionDraftInput } from "./validation"

/** Error with a status and a fixed code ("unauthorized", "conflict", "network", ...), never provider text. */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ClientApiError(0, "network")
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const code = payload && typeof payload.error === "string" ? payload.error : "server_error"
    throw new ClientApiError(response.status, code)
  }
  return (await response.json()) as T
}

export const api = {
  listPlayers: () => request<Player[]>("/api/players"),
  createPlayer: (input: PlayerCreate) => request<Player>("/api/players", "POST", input),
  deactivatePlayer: (id: string) => request<Player>(`/api/players/${id}`, "DELETE"),
  getSession: (date: string) => request<{ session: SavedSession | null }>(`/api/sessions/${date}`),
  saveSession: (date: string, draft: SessionDraftInput) =>
    request<{ session: SavedSession | null }>(`/api/sessions/${date}`, "PUT", draft),
  setPlayed: (id: string, patch: MatchPatch) => request<SavedMatch>(`/api/matches/${id}`, "PATCH", patch),
  listHistory: () => request<MatchHistory[]>("/api/history"),
}
