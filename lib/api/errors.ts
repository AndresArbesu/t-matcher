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

/** A class name only (SDK errors keep `name` as "Error"); never the message, which could carry secrets. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name || error.name : typeof error
}

/**
 * Converts anything thrown into a response with a fixed error code. Storage
 * (Blob) errors and their messages are only logged server-side as a name, never returned.
 */
export function toErrorResponse(error: unknown): NextResponse {
  let apiError: ApiError
  if (error instanceof ApiError) {
    apiError = error
  } else {
    console.error("Unhandled API error", errorName(error))
    apiError = new ApiError(500, "server_error")
  }
  return NextResponse.json({ error: apiError.code }, { status: apiError.status, headers: { "Cache-Control": "no-store" } })
}
