import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { open, readJson } from "@/lib/api/handler"
import {
  FAILED_LOGIN_DELAY_MS,
  passcodeMatches,
  resolvePasscode,
  sessionCookieHeader,
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
  response.headers.append("Set-Cookie", sessionCookieHeader(expected))
  return response
})
