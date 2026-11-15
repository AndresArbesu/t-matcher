import type { NextRequest } from "next/server"
import { isAuthenticated } from "@/lib/auth"
import type { DocStore } from "@/lib/store"
import { getStore } from "@/lib/store-instance"
import { ApiError, toErrorResponse } from "./errors"

interface OpenContext<P> {
  request: NextRequest
  params: P
}

interface Context<P> extends OpenContext<P> {
  store: DocStore
}

type Route<P> = (request: NextRequest, route: { params: Promise<P> }) => Promise<Response>

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * CSRF defence in depth on top of SameSite=Lax: a state-changing request whose
 * Origin header is present must come from the host it is addressed to.
 */
function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return
  const origin = request.headers.get("origin")
  if (origin === null) return
  const host = request.headers.get("host") ?? new URL(request.url).host
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    // not a URL ("null", garbage): rejected below
  }
  if (originHost !== host) throw new ApiError(403, "forbidden")
}

async function respond<P>(
  request: NextRequest,
  route: { params: Promise<P> },
  run: (params: P) => Promise<Response>,
): Promise<Response> {
  let response: Response
  try {
    assertSameOrigin(request)
    response = await run(await route.params)
  } catch (error) {
    response = toErrorResponse(error)
  }
  response.headers.set("Cache-Control", "no-store")
  return response
}

/** A route that needs no session (login, logout): origin check, safe errors, no caching. */
export function open<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: OpenContext<P>) => Promise<Response>,
): Route<P> {
  return (request, route) => respond(request, route, (params) => handler({ request, params }))
}

/**
 * Wraps a route handler: requires a valid session cookie and turns anything
 * thrown into a safe error response. The store is only created after the cookie
 * is verified, so an unauthenticated call never reaches the data.
 */
export function authed<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: Context<P>) => Promise<Response>,
): Route<P> {
  return (request, route) =>
    respond(request, route, async (params) => {
      if (!isAuthenticated(request)) throw new ApiError(401, "unauthorized")
      return handler({ request, store: getStore(), params })
    })
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, "invalid_request")
  }
}
