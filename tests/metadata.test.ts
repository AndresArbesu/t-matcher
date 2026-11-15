import { describe, expect, it, vi } from "vitest"

vi.mock("next/font/google", () => ({ Geist: () => ({}), Geist_Mono: () => ({}) }))
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }))

import { metadata } from "@/app/layout"

describe("site metadata", () => {
  it("uses the actual product name rather than the v0 placeholder", () => {
    expect(metadata.title).toBe("t-matcher")
    expect(metadata.description).not.toContain("v0")
  })
})
