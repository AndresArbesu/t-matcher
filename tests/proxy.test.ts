import { describe, expect, it } from "vitest"
import { proxy } from "@/proxy"

describe("Next.js proxy convention", () => {
  it("exports a request handler for auth refresh", () => {
    expect(typeof proxy).toBe("function")
  })
})
