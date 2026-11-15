import { describe, expect, it, vi } from "vitest"
import { ApiError, errorName, toErrorResponse } from "@/lib/api/errors"

describe("toErrorResponse", () => {
  it("maps ApiError to its status and fixed code, uncached", async () => {
    const res = toErrorResponse(new ApiError(404, "not_found"))
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ error: "not_found" })
  })

  it("does not interpret database-style error codes (no provider mapping remains)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = toErrorResponse({ code: "23505", message: "secret detail", details: "table x", hint: "h" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "server_error" })
  })

  it("never leaks provider messages for unknown errors and logs only a class name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    class BlobUnknownError extends Error {}
    const res = toErrorResponse(new BlobUnknownError("Vercel Blob: token vercel_blob_rw_abc denied"))
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(JSON.parse(text)).toEqual({ error: "server_error" })
    expect(text).not.toMatch(/token|vercel_blob/)
    expect(log).toHaveBeenCalledWith("Unhandled API error", "BlobUnknownError")
  })

  it("handles plain Errors and non-objects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await toErrorResponse(new Error("boom with key=abc")).text()).toBe('{"error":"server_error"}')
    expect(toErrorResponse("x").status).toBe(500)
    expect(errorName("x")).toBe("string")
  })
})
