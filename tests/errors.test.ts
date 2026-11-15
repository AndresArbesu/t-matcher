import { describe, expect, it } from "vitest"
import { ApiError, toErrorResponse } from "@/lib/api/errors"

describe("toErrorResponse", () => {
  it("maps ApiError to its status and fixed code", async () => {
    const res = toErrorResponse(new ApiError(404, "not_found"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "not_found" })
  })

  it.each([
    ["23505", 409, "conflict"],
    ["23503", 409, "in_use"],
    ["23514", 400, "invalid_request"],
    ["22P02", 400, "invalid_request"],
    ["42501", 403, "forbidden"],
  ])("maps postgres code %s to %i %s", async (code, status, error) => {
    const res = toErrorResponse({ code, message: "secret detail", details: "table x", hint: "h" })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error })
  })

  it("never leaks provider messages for unknown errors", async () => {
    const res = toErrorResponse({ code: "XX000", message: 'relation "players" JWT secret abc', details: "d" })
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(JSON.parse(text)).toEqual({ error: "server_error" })
    expect(text).not.toMatch(/relation|JWT|secret/)
  })

  it("handles plain Errors and non-objects", async () => {
    expect(await toErrorResponse(new Error("boom with key=abc")).text()).toBe('{"error":"server_error"}')
    expect(toErrorResponse("x").status).toBe(500)
  })
})
