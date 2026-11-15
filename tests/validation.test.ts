import { describe, expect, it } from "vitest"
import {
  parseMatchPatch,
  parsePlayerCreate,
  parsePlayerPatch,
  parseSessionDate,
  parseSessionDraft,
} from "@/lib/validation"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

describe("parsePlayerCreate", () => {
  it("trims the name and accepts an integer skill", () => {
    expect(parsePlayerCreate({ name: "  Ana ", skill_level: 3 })).toEqual({
      ok: true,
      value: { name: "Ana", skill_level: 3 },
    })
  })
  it.each([
    [{ name: "", skill_level: 3 }],
    [{ name: "   ", skill_level: 3 }],
    [{ name: "x".repeat(81), skill_level: 3 }],
    [{ name: "Ana", skill_level: 0 }],
    [{ name: "Ana", skill_level: 11 }],
    [{ name: "Ana", skill_level: 2.5 }],
    [{ name: "Ana", skill_level: "3" }],
    [{ name: "Ana" }],
    [null],
    ["str"],
  ])("rejects %j", (body) => {
    expect(parsePlayerCreate(body).ok).toBe(false)
  })
  it("ignores unknown keys such as owner_id", () => {
    const r = parsePlayerCreate({ name: "Ana", skill_level: 3, owner_id: id(9) })
    expect(r).toEqual({ ok: true, value: { name: "Ana", skill_level: 3 } })
  })
})

describe("parsePlayerPatch", () => {
  it("accepts partial updates", () => {
    expect(parsePlayerPatch({ active: false })).toEqual({ ok: true, value: { active: false } })
    expect(parsePlayerPatch({ name: " Bo ", skill_level: 4 })).toEqual({
      ok: true,
      value: { name: "Bo", skill_level: 4 },
    })
  })
  it("rejects an empty patch and bad types", () => {
    expect(parsePlayerPatch({}).ok).toBe(false)
    expect(parsePlayerPatch({ active: "no" }).ok).toBe(false)
    expect(parsePlayerPatch({ skill_level: 99 }).ok).toBe(false)
  })
})

describe("parseSessionDate", () => {
  it("accepts real calendar dates only", () => {
    expect(parseSessionDate("2026-11-15")).toBe("2026-11-15")
    expect(parseSessionDate("2026-02-30")).toBeNull()
    expect(parseSessionDate("15/11/2026")).toBeNull()
    expect(parseSessionDate("2026-11-15T00:00:00Z")).toBeNull()
    expect(parseSessionDate("")).toBeNull()
  })
})

describe("parseSessionDraft", () => {
  const m = (a: number, b: number, c: number, d: number, locked = false) => ({
    team1: [id(a), id(b)],
    team2: [id(c), id(d)],
    locked,
  })

  it("accepts participants with ordered matches", () => {
    const body = { participants: [1, 2, 3, 4, 5, 6, 7, 8].map(id), matches: [m(1, 2, 3, 4, true), m(5, 6, 7, 8)] }
    const r = parseSessionDraft(body)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.matches[0].locked).toBe(true)
  })
  it("accepts a participants-only draft", () => {
    expect(parseSessionDraft({ participants: [id(1)], matches: [] }).ok).toBe(true)
  })
  it.each([
    ["non-uuid participant", { participants: ["abc"], matches: [] }],
    ["duplicate participants", { participants: [id(1), id(1)], matches: [] }],
    ["missing participants", { matches: [] }],
    ["match player not a participant", { participants: [1, 2, 3].map(id), matches: [m(1, 2, 3, 4)] }],
    ["same player twice in a match", { participants: [1, 2, 3].map(id), matches: [m(1, 1, 2, 3)] }],
    ["player in two matches", { participants: [1, 2, 3, 4, 5, 6].map(id), matches: [m(1, 2, 3, 4), m(1, 5, 6, 2)] }],
    [
      "team of one",
      { participants: [1, 2, 3, 4].map(id), matches: [{ team1: [id(1)], team2: [id(2), id(3)], locked: false }] },
    ],
    ["non-boolean locked", { participants: [1, 2, 3, 4].map(id), matches: [{ ...m(1, 2, 3, 4), locked: "yes" }] }],
    ["too many participants", { participants: Array.from({ length: 65 }, (_, i) => id(i + 1)), matches: [] }],
  ])("rejects %s", (_n, body) => {
    expect(parseSessionDraft(body).ok).toBe(false)
  })
})

describe("parseMatchPatch", () => {
  it("accepts played flag with optional trimmed notes", () => {
    expect(parseMatchPatch({ played: true, notes: " good " })).toEqual({
      ok: true,
      value: { played: true, notes: "good" },
    })
    expect(parseMatchPatch({ played: false })).toEqual({ ok: true, value: { played: false } })
  })
  it("rejects bad payloads", () => {
    expect(parseMatchPatch({}).ok).toBe(false)
    expect(parseMatchPatch({ played: "yes" }).ok).toBe(false)
    expect(parseMatchPatch({ played: true, notes: "x".repeat(1001) }).ok).toBe(false)
  })
})
