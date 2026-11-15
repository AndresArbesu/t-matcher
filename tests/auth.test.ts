import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  SESSION_VALID_FOR_MS,
  isAuthenticated,
  passcodeMatches,
  readCookie,
  resolvePasscode,
  sessionCookieHeader,
  signSession,
  verifySession,
} from "@/lib/auth"

afterEach(() => vi.unstubAllEnvs())

const NOW = 1_800_000_000_000
const hmac = (pass: string, exp: number) => createHmac("sha256", pass).update(`t-matcher-session-v1.${exp}`).digest("hex")

describe("session cookie", () => {
  it("is named tm_session; the browser copy lasts 400 days (the longest browsers keep) and the signature is valid for 10 years", () => {
    expect(SESSION_COOKIE).toBe("tm_session")
    expect(SESSION_MAX_AGE_S).toBe(400 * 24 * 60 * 60)
    expect(SESSION_VALID_FOR_MS).toBe(10 * 365 * 24 * 60 * 60 * 1000)
  })

  it("builds a Set-Cookie header with a fresh 10-year signature and a 400-day lifetime", () => {
    vi.stubEnv("NODE_ENV", "production")
    const header = sessionCookieHeader("secret", NOW)
    const value = /tm_session=([^;]+)/.exec(header)![1]
    expect(value).toBe(signSession("secret", NOW + SESSION_VALID_FOR_MS))
    expect(header).toMatch(/Max-Age=34560000/)
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Lax/i)
    expect(header).toMatch(/Path=\//)
    expect(header).toMatch(/Secure/)
    vi.stubEnv("NODE_ENV", "development")
    expect(sessionCookieHeader("secret", NOW)).not.toMatch(/Secure/)
  })

  it("has the format <expiresAtMs>.<hex hmac-sha256 over the versioned message>", () => {
    const exp = NOW + 1000
    expect(signSession("secret", exp)).toBe(`${exp}.${hmac("secret", exp)}`)
    expect(signSession("secret", exp)).toMatch(/^\d+\.[0-9a-f]{64}$/)
  })

  it("verifies a fresh cookie", () => {
    expect(verifySession(signSession("secret", NOW + 1), "secret", NOW)).toBe(true)
  })

  it("rejects an expired cookie, including exactly at expiry", () => {
    expect(verifySession(signSession("secret", NOW - 1), "secret", NOW)).toBe(false)
    expect(verifySession(signSession("secret", NOW), "secret", NOW)).toBe(false)
  })

  it("rejects a cookie signed with another passcode (changing the passcode ends every session)", () => {
    expect(verifySession(signSession("old", NOW + 1000), "new", NOW)).toBe(false)
  })

  it("rejects a tampered expiry or signature", () => {
    const [exp, sig] = signSession("secret", NOW + 1000).split(".")
    expect(verifySession(`${Number(exp) + 999999}.${sig}`, "secret", NOW)).toBe(false)
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1)
    expect(verifySession(`${exp}.${flipped}`, "secret", NOW)).toBe(false)
    expect(verifySession(`${exp}.${sig.slice(0, -2)}`, "secret", NOW)).toBe(false)
    expect(verifySession(`${exp}.${sig}00`, "secret", NOW)).toBe(false)
  })

  it.each([undefined, "", "garbage", ".", "123.", ".abc", "12e3.abc", "-5.abc", "1.2.3", "NaN.00", `${NOW + 5}.zz${"0".repeat(62)}`])(
    "rejects malformed cookie %j without throwing",
    (value) => {
      expect(verifySession(value, "secret", NOW)).toBe(false)
    },
  )
})

describe("passcodeMatches", () => {
  it("accepts the exact passcode only", () => {
    expect(passcodeMatches("hunter2-long", "hunter2-long")).toBe(true)
    expect(passcodeMatches("hunter2-lonG", "hunter2-long")).toBe(false)
    expect(passcodeMatches("", "hunter2-long")).toBe(false)
    expect(passcodeMatches("hunter2-long ", "hunter2-long")).toBe(false)
  })
  it("handles inputs of any length and non-strings", () => {
    expect(passcodeMatches("x".repeat(100000), "short")).toBe(false)
    expect(passcodeMatches(undefined as never, "short")).toBe(false)
  })
})

describe("resolvePasscode", () => {
  it("uses APP_PASSCODE when set", () => {
    vi.stubEnv("APP_PASSCODE", "abc")
    expect(resolvePasscode()).toBe("abc")
  })

  it("falls back to 'dev' only locally (no VERCEL)", () => {
    vi.stubEnv("APP_PASSCODE", "")
    vi.stubEnv("VERCEL", "")
    expect(resolvePasscode()).toBe("dev")
  })

  it("fails closed with a generic 500 on Vercel when APP_PASSCODE is unset or empty", () => {
    vi.stubEnv("VERCEL", "1")
    for (const value of [undefined, ""]) {
      if (value === undefined) delete process.env.APP_PASSCODE
      else vi.stubEnv("APP_PASSCODE", value)
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const err = (() => {
        try {
          resolvePasscode()
        } catch (e) {
          return e
        }
      })()
      expect(err).toBeInstanceOf(ApiError)
      expect(err).toMatchObject({ status: 500, code: "server_error" })
      log.mockRestore()
    }
  })
})

describe("readCookie / isAuthenticated", () => {
  const withCookie = (cookie?: string) => new Request("http://localhost/api/x", { headers: cookie ? { cookie } : {} })

  it("reads one cookie out of a header with several", () => {
    expect(readCookie(withCookie("a=1; tm_session=abc.def; b=2"), "tm_session")).toBe("abc.def")
    expect(readCookie(withCookie("a=1"), "tm_session")).toBeUndefined()
    expect(readCookie(withCookie(), "tm_session")).toBeUndefined()
  })

  it("is true only for a valid, unexpired cookie signed with the current passcode", () => {
    vi.stubEnv("APP_PASSCODE", "pw")
    const good = signSession("pw", Date.now() + 60_000)
    expect(isAuthenticated(withCookie(`tm_session=${good}`))).toBe(true)
    expect(isAuthenticated(withCookie(`tm_session=${signSession("pw", Date.now() - 1)}`))).toBe(false)
    expect(isAuthenticated(withCookie(`tm_session=${signSession("other", Date.now() + 60_000)}`))).toBe(false)
    expect(isAuthenticated(withCookie())).toBe(false)
  })
})
