import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { open } from "@/lib/api/handler"
import { isAuthenticated, resolvePasscode, sessionCookieHeader } from "@/lib/auth"

/** Tells the page whether its cookie is a valid session. Touches no data. */
export const GET = open(async ({ request }) => {
  if (!isAuthenticated(request)) throw new ApiError(401, "unauthorized")
  // Opening the app renews the session too (sliding expiry).
  const response = NextResponse.json({ ok: true })
  response.headers.append("Set-Cookie", sessionCookieHeader(resolvePasscode()))
  return response
})
