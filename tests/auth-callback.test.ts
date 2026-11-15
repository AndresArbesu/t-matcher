import { beforeEach, describe, expect, it, vi } from "vitest"

const { exchange, createClient } = vi.hoisted(() => ({ exchange: vi.fn(), createClient: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }))

import { GET } from "@/app/auth/callback/route"

const call = (qs: string) => GET(new Request(`http://localhost:3000/auth/callback${qs}`) as never)

beforeEach(() => {
  vi.clearAllMocks()
  createClient.mockResolvedValue({ auth: { exchangeCodeForSession: exchange } })
  exchange.mockResolvedValue({ error: null })
})

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects home", async () => {
    const res = await call("?code=abc")
    expect(exchange).toHaveBeenCalledWith("abc")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://localhost:3000/")
  })

  it("ignores any next/redirect parameter (no open redirect)", async () => {
    const res = await call("?code=abc&next=https://evil.example/&redirect_to=//evil.example")
    expect(res.headers.get("location")).toBe("http://localhost:3000/")
  })

  it.each([["missing code", ""], ["exchange error", "?code=bad"]])("redirects with a generic flag on %s", async (_n, qs) => {
    exchange.mockResolvedValue({ error: { message: "invalid flow state secret" } })
    const res = await call(qs)
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth_error=1")
  })

  it("redirects with the generic flag when the client cannot be created", async () => {
    createClient.mockRejectedValue(new Error("Missing env"))
    const res = await call("?code=abc")
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth_error=1")
  })
})
