import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { FileStore } from "@/lib/file-store"
import { StoreConflictError, emptyDoc, mutate, type Doc } from "@/lib/store"
import { MemoryStore } from "./helpers/memory-store"

const addPlayer = (doc: Doc, name = "Ana") => void doc.players.push({ id: name, name, skill_level: 3, active: true })

describe("emptyDoc", () => {
  it("is a versioned empty document", () => {
    expect(emptyDoc()).toEqual({ version: 1, players: [], sessions: {}, meta: {} })
  })
})

describe("mutate", () => {
  it("reads an absent document as empty, applies fn and performs the first write", async () => {
    const store = new MemoryStore()
    const result = await mutate(store, (doc) => {
      addPlayer(doc)
      return "done"
    })
    expect(result).toBe("done")
    expect(store.doc?.players).toHaveLength(1)
    expect(store.writes).toBe(1)
  })

  it("re-reads and retries when another writer got in between", async () => {
    const store = new MemoryStore()
    store.external((d) => addPlayer(d, "Other"))
    store.interfereOnce(() => store.external((d) => addPlayer(d, "Racer")))
    let calls = 0
    await mutate(store, (doc) => {
      calls++
      addPlayer(doc)
    })
    expect(calls).toBe(2)
    expect(store.doc?.players.map((p) => p.name)).toEqual(["Other", "Racer", "Ana"])
  })

  it("retries a conflicting first write", async () => {
    const store = new MemoryStore()
    store.interfereOnce(() => store.external((d) => addPlayer(d, "Racer")))
    await mutate(store, (doc) => addPlayer(doc))
    expect(store.doc?.players.map((p) => p.name)).toEqual(["Racer", "Ana"])
  })

  it("gives up after 6 attempts with a 409 conflict", async () => {
    const store = new MemoryStore()
    store.failNextWrites(10)
    const err = await mutate(store, (d) => addPlayer(d)).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: "conflict" })
    expect(store.writes).toBe(6)
    expect(store.reads).toBe(6)
  })

  it("succeeds on the last allowed attempt (after short pauses between tries)", async () => {
    const store = new MemoryStore()
    store.failNextWrites(5)
    const started = Date.now()
    await mutate(store, (d) => addPlayer(d))
    expect(Date.now() - started).toBeGreaterThanOrEqual(80) // backs off instead of hammering the store
    expect(store.writes).toBe(6)
    expect(store.doc?.players).toHaveLength(1)
  })

  it("propagates errors thrown by fn without writing", async () => {
    const store = new MemoryStore()
    await expect(
      mutate(store, () => {
        throw new ApiError(404, "not_found")
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(store.writes).toBe(0)
  })

  it("does not write when fn changed nothing", async () => {
    const store = new MemoryStore()
    await mutate(store, () => "noop")
    expect(store.writes).toBe(0)
    expect(store.doc).toBeNull()
  })

  it("does not swallow other write errors", async () => {
    const store = new MemoryStore()
    store.write = async () => {
      throw new Error("disk on fire")
    }
    await expect(mutate(store, (d) => addPlayer(d))).rejects.toThrow("disk on fire")
  })
})

describe("FileStore", () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tm-store-"))
    file = path.join(dir, "nested", "store.json")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("reads an absent file as an empty document with a null etag", async () => {
    expect(await new FileStore(file).read()).toEqual({ doc: emptyDoc(), etag: null })
  })

  it("creates the directory, persists JSON and returns a content-hash etag", async () => {
    const store = new FileStore(file)
    const doc = emptyDoc()
    addPlayer(doc)
    const etag = await store.write(doc, null)
    expect(JSON.parse(readFileSync(file, "utf8")).players).toHaveLength(1)
    const read = await store.read()
    expect(read.etag).toBe(etag)
    expect(read.doc).toEqual(doc)
  })

  it("rejects a first write when the file already exists", async () => {
    const store = new FileStore(file)
    await store.write(emptyDoc(), null)
    await expect(store.write(emptyDoc(), null)).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("rejects a write with a stale etag and accepts the current one", async () => {
    const store = new FileStore(file)
    const first = await store.write(emptyDoc(), null)
    const doc = emptyDoc()
    addPlayer(doc)
    const second = await store.write(doc, first)
    expect(second).not.toBe(first)
    await expect(store.write(emptyDoc(), first)).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("rejects a write with an etag when the file is gone", async () => {
    await expect(new FileStore(file).write(emptyDoc(), "deadbeef")).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("detects an out-of-band edit through the etag", async () => {
    const store = new FileStore(file)
    const etag = await store.write(emptyDoc(), null)
    writeFileSync(file, JSON.stringify({ ...emptyDoc(), meta: { lastSnapshot: "x" } }))
    await expect(store.write(emptyDoc(), etag)).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("refuses a document with an unknown version instead of misreading it", async () => {
    const store = new FileStore(file)
    await store.write(emptyDoc(), null)
    writeFileSync(file, JSON.stringify({ version: 2, players: [], sessions: {}, meta: {} }))
    await expect(store.read()).rejects.toThrow()
  })
})
