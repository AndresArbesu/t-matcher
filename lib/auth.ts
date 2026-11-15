import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { ApiError } from "./api/errors"

export const SESSION_COOKIE = "tm_session"
export const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60
/** Pause after a wrong passcode. A serverless function cannot rate-limit globally, so the passcode itself must be strong. */
export const FAILED_LOGIN_DELAY_MS = 1000

const MESSAGE_PREFIX = "t-matcher-session-v1."

/** The shared passcode. Required on Vercel (fails closed); falls back to "dev" for local development only. */
export function resolvePasscode(): string {
  const passcode = process.env.APP_PASSCODE
  if (passcode) return passcode
  if (process.env.VERCEL) {
    console.error("APP_PASSCODE is not set")
    throw new ApiError(500, "server_error")
  }
  return "dev"
}

const digest = (value: string) => createHash("sha256").update(value).digest()

/** Constant-time comparison (both sides are hashed first so lengths are equal). */
export function passcodeMatches(input: unknown, passcode: string): boolean {
  if (typeof input !== "string") return false
  return timingSafeEqual(digest(input), digest(passcode))
}

const sign = (passcode: string, expiresAtMs: number) =>
  createHmac("sha256", passcode).update(`${MESSAGE_PREFIX}${expiresAtMs}`).digest("hex")

/** `<expiresAtMs>.<hex hmac>`. Keyed with the passcode, so changing the passcode invalidates every session. */
export const signSession = (passcode: string, expiresAtMs: number) => `${expiresAtMs}.${sign(passcode, expiresAtMs)}`

export function verifySession(value: string | undefined, passcode: string, nowMs: number): boolean {
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value ?? "")
  if (!match) return false
  const expiresAtMs = Number(match[1])
  const expected = Buffer.from(sign(passcode, expiresAtMs), "hex")
  const actual = Buffer.from(match[2], "hex")
  return timingSafeEqual(expected, actual) && expiresAtMs > nowMs
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=")
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

export function isAuthenticated(request: Request): boolean {
  const passcode = resolvePasscode()
  return verifySession(readCookie(request, SESSION_COOKIE), passcode, Date.now())
}
