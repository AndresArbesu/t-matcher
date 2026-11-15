import type { SupabaseClient, User } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ApiError, toErrorResponse } from "./errors"

interface Context<P> {
  request: NextRequest
  supabase: SupabaseClient
  user: User
  params: P
}

/**
 * Wraps a route handler: requires a signed-in user (validated with the auth
 * server via getUser, not just read from the cookie) and turns anything thrown
 * into a safe error response.
 */
export function authed<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: Context<P>) => Promise<Response>,
) {
  return async (request: NextRequest, route: { params: Promise<P> }): Promise<Response> => {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user) throw new ApiError(401, "unauthorized")
      return await handler({ request, supabase, user: data.user, params: await route.params })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, "invalid_request")
  }
}
