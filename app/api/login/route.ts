import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { open, readJson } from "@/lib/api/handler"
import {
  FAILED_LOGIN_DELAY_MS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  passcodeMatches,
  resolvePasscode,
  signSession,
} from "@/lib/auth"

/** Exchanges the shared passcode for a signed, httpOnly session cookie. */
export const POST = open(async ({ request }) => {
  const body = await readJson(request)
  const passcode = typeof body === "object" && body !== null ? (body as { passcode?: unknown }).passcode : undefined
  if (typeof passcode !== "string") throw new ApiError(400, "invalid_request")

  const expected = resolvePasscode()
  if (!passcodeMatches(passcode, expected)) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS))
    throw new ApiError(401, "unauthorized")
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, signSession(expected, Date.now() + SESSION_MAX_AGE_S * 1000), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  })
  return response
})
