import { spawn } from "node:child_process"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { MemoryStore } from "./helpers/memory-store"

const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock("@/lib/store-instance", () => ({ getStore: () => holder.store }))

import * as exportRoute from "@/app/api/export/route"
import * as historyRoute from "@/app/api/history/route"
import * as loginRoute from "@/app/api/login/route"
import * as logoutRoute from "@/app/api/logout/route"
import * as matchRoute from "@/app/api/matches/[id]/route"
import * as playersRoute from "@/app/api/players/route"
import * as sessionRoute from "@/app/api/sessions/[date]/route"
import * as whoamiRoute from "@/app/api/session/route"

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const routes: { method: string; pattern: RegExp; handler: Handler; keys: string[] }[] = [
  { method: "GET", pattern: /^\/api\/players$/, handler: playersRoute.GET as Handler, keys: [] },
  { method: "POST", pattern: /^\/api\/players$/, handler: playersRoute.POST as Handler, keys: [] },
  { method: "GET", pattern: /^\/api\/sessions\/([^/]+)$/, handler: sessionRoute.GET as Handler, keys: ["date"] },
  { method: "PUT", pattern: /^\/api\/sessions\/([^/]+)$/, handler: sessionRoute.PUT as Handler, keys: ["date"] },
  { method: "PATCH", pattern: /^\/api\/matches\/([^/]+)$/, handler: matchRoute.PATCH as Handler, keys: ["id"] },
  { method: "GET", pattern: /^\/api\/history$/, handler: historyRoute.GET as Handler, keys: [] },
  { method: "GET", pattern: /^\/api\/export$/, handler: exportRoute.GET as Handler, keys: [] },
  { method: "GET", pattern: /^\/api\/session$/, handler: whoamiRoute.GET as Handler, keys: [] },
  { method: "POST", pattern: /^\/api\/login$/, handler: loginRoute.POST as Handler, keys: [] },
  { method: "POST", pattern: /^\/api\/logout$/, handler: logoutRoute.POST as Handler, keys: [] },
]

let server: Server
let baseUrl: string

beforeAll(async () => {
  holder.store = new MemoryStore()
  vi.stubEnv("APP_PASSCODE", "smoke-test-passcode")
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname))
    if (!route) {
      res.statusCode = 404
      res.end("{}")
      return
    }
    const match = route.pattern.exec(url.pathname)!
    const params = Object.fromEntries(route.keys.map((k, i) => [k, match[i + 1]]))
    const hasBody = chunks.length > 0
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    })
    const response = await route.handler(request, { params: Promise.resolve(params) })
    res.statusCode = response.status
    response.headers.forEach((value, key) => key !== "set-cookie" && res.setHeader(key, value))
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) res.setHeader("set-cookie", cookies)
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await new Promise((resolve) => server.close(resolve))
})

function runSmoke(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "smoke.mjs")], {
      env: { ...process.env, APP_PASSCODE: "", BLOB_READ_WRITE_TOKEN: "", ...env },
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    child.on("close", (code) => resolve({ code, out }))
  })
}

describe("scripts/smoke.mjs", () => {
  it("passes against a server running the real routes", async () => {
    const result = await runSmoke({ BASE_URL: baseUrl, APP_PASSCODE: "smoke-test-passcode" })
    expect(result.out).toMatch(/^PASS/m)
    expect(result.code).toBe(0)
  })

  it("fails with a clear message when the passcode is wrong", async () => {
    const result = await runSmoke({ BASE_URL: baseUrl, APP_PASSCODE: "not-the-passcode" })
    expect(result.code).toBe(1)
    expect(result.out).toMatch(/FAIL: login with the passcode should be 200/)
  })

  it("refuses a non-local BASE_URL unless ALLOW_REMOTE=1, without making any request", async () => {
    const result = await runSmoke({ BASE_URL: "https://t-matcher.example.invalid" })
    expect(result.code).toBe(1)
    expect(result.out).toMatch(/REFUSING/)
    expect(result.out).toMatch(/ALLOW_REMOTE=1/)
  })

  it("fails clearly when nothing is listening", async () => {
    const result = await runSmoke({ BASE_URL: "http://127.0.0.1:9" })
    expect(result.code).toBe(1)
    expect(result.out).toMatch(/FAIL: cannot reach/)
  })
})
