import { NextResponse } from "next/server"

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "invalid_players"
  | "not_found"
  | "conflict"
  | "in_use"
  | "server_error"

/** An error that is safe to show to the client: only a status and a fixed code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(code)
  }
}

const POSTGRES_CODES: Record<string, ApiError> = {
  "23505": new ApiError(409, "conflict"),
  "23503": new ApiError(409, "in_use"),
  "23514": new ApiError(400, "invalid_request"),
  "22P02": new ApiError(400, "invalid_request"),
  "42501": new ApiError(403, "forbidden"),
}

/**
 * Converts anything thrown into a response with a fixed error code. Provider
 * (Supabase/Postgres) messages, details and hints are only logged server-side
 * as a code, never returned.
 */
export function toErrorResponse(error: unknown): NextResponse {
  let apiError: ApiError | undefined
  if (error instanceof ApiError) {
    apiError = error
  } else if (typeof error === "object" && error !== null && "code" in error) {
    apiError = POSTGRES_CODES[String((error as { code: unknown }).code)]
  }
  if (!apiError) {
    console.error("Unhandled API error", error instanceof Error ? error.name : typeof error)
    apiError = new ApiError(500, "server_error")
  }
  return NextResponse.json({ error: apiError.code }, { status: apiError.status })
}
