import { BlobError, BlobPreconditionFailedError, BlobUnknownError } from "@vercel/blob"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BlobStore, DATA_PATH, SNAPSHOT_PREFIX, type BlobClient } from "@/lib/blob-store"
import { StoreConflictError, emptyDoc, mutate, type Doc } from "@/lib/store"

/** A fake of the four Blob functions the store uses, with etag + overwrite semantics. */
function fakeBlob() {
  const files = new Map<string, { body: string; etag: string }>()
  let n = 0
  const calls: { fn: string; args: unknown[] }[] = []
  const fail: { put?: (path: string) => boolean; list?: boolean; del?: boolean; firstPutUnknown?: boolean } = {}
  const client = {
    get: vi.fn(async (pathname: string, options: unknown) => {
      calls.push({ fn: "get", args: [pathname, options] })
      const f = files.get(pathname)
      if (!f) return null
      // The real service answers reads with a WEAK etag (W/"..."), but ifMatch on put only accepts the strong one.
      return { statusCode: 200, stream: new Response(f.body).body, blob: { etag: `W/${f.etag}` } }
    }),
    put: vi.fn(async (pathname: string, body: string, options: { ifMatch?: string; allowOverwrite?: boolean }) => {
      calls.push({ fn: "put", args: [pathname, body, options] })
      if (fail.put?.(pathname)) throw new BlobUnknownError()
      const existing = files.get(pathname)
      if (options.ifMatch !== undefined && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError()
      if (existing && !options.allowOverwrite && options.ifMatch === undefined) {
        throw fail.firstPutUnknown ? new BlobUnknownError() : new BlobPreconditionFailedError()
      }
      const etag = `"e${++n}"`
      files.set(pathname, { body, etag })
      return { etag, pathname }
    }),
    list: vi.fn(async (options: { prefix?: string; cursor?: string }) => {
      calls.push({ fn: "list", args: [options] })
      if (fail.list) throw new BlobUnknownError()
      const blobs = [...files.keys()].filter((p) => p.startsWith(options.prefix ?? "")).map((pathname) => ({ pathname }))
      return { blobs, hasMore: false }
    }),
    del: vi.fn(async (paths: string | string[]) => {
      calls.push({ fn: "del", args: [paths] })
      if (fail.del) throw new BlobUnknownError()
      for (const p of [paths].flat()) files.delete(p)
    }),
  }
  return { client: client as unknown as BlobClient, files, calls, fail, mocks: client }
}

const at = (iso: string) => () => new Date(iso)
// A document whose snapshot for "today" is already recorded, so only the document itself is written.
const snapshotted: Doc = { ...emptyDoc(), meta: { lastSnapshot: "2026-11-15" } }
const addPlayer = (doc: Doc, name = "Ana") => void doc.players.push({ id: name, name, skill_level: 3, active: true })
const snapshots = (files: Map<string, unknown>) => [...files.keys()].filter((k) => k.startsWith(SNAPSHOT_PREFIX)).sort()

afterEach(() => vi.restoreAllMocks())

describe("BlobStore read", () => {
  it("reads a missing blob (get returns null) as an empty document with a null etag", async () => {
    const { client } = fakeBlob()
    expect(await new BlobStore(client).read()).toEqual({ doc: emptyDoc(), etag: null })
  })

  it("uses a private, uncached (consistent) read of the fixed pathname", async () => {
    const { client, mocks } = fakeBlob()
    await new BlobStore(client).read()
    expect(DATA_PATH).toBe("t-matcher/data.json")
    expect(mocks.get).toHaveBeenCalledWith("t-matcher/data.json", { access: "private", useCache: false })
  })

  it("parses the stored document and returns the blob etag", async () => {
    const { client, files } = fakeBlob()
    const doc = emptyDoc()
    addPlayer(doc)
    files.set(DATA_PATH, { body: JSON.stringify(doc), etag: '"abc"' })
    expect(await new BlobStore(client).read()).toEqual({ doc, etag: '"abc"' })
  })

  it("fails on an unsupported document rather than treating it as empty", async () => {
    const { client, files } = fakeBlob()
    files.set(DATA_PATH, { body: JSON.stringify({ version: 9 }), etag: '"abc"' })
    await expect(new BlobStore(client).read()).rejects.toThrow()
  })

  it("fails on an unexpected 304", async () => {
    const { client, mocks } = fakeBlob()
    mocks.get.mockResolvedValueOnce({ statusCode: 304, stream: null, blob: { etag: "x" } } as never)
    await expect(new BlobStore(client).read()).rejects.toThrow()
  })
})

describe("BlobStore write", () => {
  it("writes a private JSON blob with ifMatch when an etag is known", async () => {
    const { client, files, mocks } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    const etag1 = await store.write(emptyDoc(), null)
    const doc = emptyDoc()
    addPlayer(doc)
    const etag2 = await store.write(doc, etag1)
    expect(etag2).not.toBe(etag1)
    const second = mocks.put.mock.calls.filter(([p]) => p === DATA_PATH)[1]
    expect(second[2]).toMatchObject({ access: "private", contentType: "application/json", allowOverwrite: true, ifMatch: etag1 })
    expect(JSON.parse(files.get(DATA_PATH)!.body).players).toHaveLength(1)
  })

  it("makes the first write succeed only when nothing exists (no ifMatch, no overwrite)", async () => {
    const { client, mocks } = fakeBlob()
    await new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)
    const options = mocks.put.mock.calls.find(([p]) => p === DATA_PATH)![2] as Record<string, unknown>
    expect(options).not.toHaveProperty("ifMatch")
    expect(options.allowOverwrite).toBe(false)
  })

  it("maps a precondition failure to a StoreConflictError", async () => {
    const { client } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    await store.write(emptyDoc(), null)
    await expect(store.write(emptyDoc(), '"stale"')).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("maps a first write that finds the document already there to a conflict, even if the SDK error is unspecific", async () => {
    const { client, files, fail } = fakeBlob()
    fail.firstPutUnknown = true
    files.set(DATA_PATH, { body: JSON.stringify(emptyDoc()), etag: '"other"' })
    await expect(new BlobStore(client).write(emptyDoc(), null)).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("maps the service's 'conflicting operation' error (simultaneous writers) to a conflict so it is retried", async () => {
    const { client, mocks } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    const etag = await store.write(emptyDoc(), null)
    mocks.put.mockRejectedValueOnce(
      new BlobError("Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource."),
    )
    await expect(store.write(snapshotted, etag)).rejects.toBeInstanceOf(StoreConflictError)
  })

  it("does not treat unrelated blob errors as conflicts", async () => {
    const { client, mocks } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    const etag = await store.write(emptyDoc(), null)
    mocks.put.mockRejectedValueOnce(new BlobError("Vercel Blob: Something else went wrong"))
    await expect(store.write(snapshotted, etag)).rejects.not.toBeInstanceOf(StoreConflictError)
  })

  it("rethrows other errors from the first write (nothing exists, so it is not a race)", async () => {
    const { client, fail } = fakeBlob()
    fail.put = (p) => p === DATA_PATH
    await expect(new BlobStore(client).write(emptyDoc(), null)).rejects.toBeInstanceOf(BlobUnknownError)
  })

  it("composes with mutate: a writer that commits in between is detected via the etag and retried", async () => {
    const { client, files } = fakeBlob()
    const now = at("2026-11-15T10:00:00Z")
    const store = new BlobStore(client, now)
    const racer = new BlobStore(client, now)
    await mutate(store, (d) => addPlayer(d, "A"))
    await mutate(store, (d) => addPlayer(d, "B"))
    const original = store.read.bind(store)
    let raced = false
    store.read = async () => {
      const result = await original()
      if (!raced) {
        raced = true
        const other = await racer.read()
        addPlayer(other.doc, "C")
        await racer.write(other.doc, other.etag)
      }
      return result
    }
    await mutate(store, (d) => addPlayer(d, "D"))
    const names = JSON.parse(files.get(DATA_PATH)!.body).players.map((p: { name: string }) => p.name)
    expect(names).toEqual(["A", "B", "C", "D"])
  })
})

describe("daily snapshot", () => {
  it("writes today's snapshot before the document and records it in meta.lastSnapshot", async () => {
    const { client, files, calls } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T23:59:00Z"))
    const doc = emptyDoc()
    addPlayer(doc)
    await store.write(doc, null)
    expect(snapshots(files)).toEqual(["t-matcher/snapshots/2026-11-15.json"])
    const puts = calls.filter((c) => c.fn === "put").map((c) => c.args[0])
    expect(puts).toEqual(["t-matcher/snapshots/2026-11-15.json", DATA_PATH])
    const snap = JSON.parse(files.get("t-matcher/snapshots/2026-11-15.json")!.body)
    expect(snap.players).toHaveLength(1)
    expect(JSON.parse(files.get(DATA_PATH)!.body).meta.lastSnapshot).toBe("2026-11-15")
    expect(doc.meta.lastSnapshot).toBeUndefined() // the caller's object is not mutated
  })

  it("uses private access and overwrite for the snapshot", async () => {
    const { client, mocks } = fakeBlob()
    await new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)
    const options = mocks.put.mock.calls.find(([p]) => p.startsWith(SNAPSHOT_PREFIX))![2]
    expect(options).toMatchObject({ access: "private", allowOverwrite: true })
  })

  it("takes at most one snapshot per UTC day", async () => {
    const { client, mocks } = fakeBlob()
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    let etag = await store.write(emptyDoc(), null)
    for (let i = 0; i < 3; i++) {
      const { doc, etag: e } = await store.read()
      addPlayer(doc, `P${i}`)
      etag = await store.write(doc, e)
    }
    expect(etag).toBeTruthy()
    expect(mocks.put.mock.calls.filter(([p]) => p.startsWith(SNAPSHOT_PREFIX))).toHaveLength(1)
  })

  it("takes a new snapshot when the UTC date changes", async () => {
    const { client, files } = fakeBlob()
    let now = new Date("2026-11-15T10:00:00Z")
    const store = new BlobStore(client, () => now)
    await store.write(emptyDoc(), null)
    now = new Date("2026-11-16T00:00:01Z")
    const { doc, etag } = await store.read()
    addPlayer(doc)
    await store.write(doc, etag)
    expect(snapshots(files)).toEqual(["t-matcher/snapshots/2026-11-15.json", "t-matcher/snapshots/2026-11-16.json"])
  })

  it("keeps only the newest 30 snapshots", async () => {
    const { client, files, mocks } = fakeBlob()
    for (let d = 1; d <= 35; d++) files.set(`${SNAPSHOT_PREFIX}2026-10-${String(d).padStart(2, "0")}.json`, { body: "{}", etag: "x" })
    // the 35 above include invalid dates on purpose; names still sort lexicographically
    await new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)
    const left = snapshots(files)
    expect(left).toHaveLength(30)
    expect(left.at(-1)).toBe("t-matcher/snapshots/2026-11-15.json")
    expect(left).not.toContain("t-matcher/snapshots/2026-10-01.json")
    expect(left).toContain("t-matcher/snapshots/2026-10-35.json")
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ prefix: SNAPSHOT_PREFIX }))
    expect(files.has(DATA_PATH)).toBe(true)
  })

  it("follows list pagination when pruning", async () => {
    const { client, files, mocks } = fakeBlob()
    for (let d = 1; d <= 40; d++) files.set(`${SNAPSHOT_PREFIX}2026-09-${String(d).padStart(2, "0")}.json`, { body: "{}", etag: "x" })
    const all = [...files.keys()].map((pathname) => ({ pathname }))
    mocks.list.mockImplementation(async (options: { cursor?: string }) =>
      options.cursor ? { blobs: all.slice(20), hasMore: false } : { blobs: all.slice(0, 20), hasMore: true, cursor: "c1" },
    )
    await new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.del).toHaveBeenCalled()
    // 40 old + today's = 41 → 11 removed, deleted names are the oldest
    const deleted = mocks.del.mock.calls.flatMap(([p]) => [p].flat())
    expect(deleted).toHaveLength(10)
    expect(deleted).toContain(`${SNAPSHOT_PREFIX}2026-09-01.json`)
  })

  it("does not fail the write when the snapshot cannot be saved, and retries next time", async () => {
    const { client, files, fail } = fakeBlob()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    fail.put = (p) => p.startsWith(SNAPSHOT_PREFIX)
    const store = new BlobStore(client, at("2026-11-15T10:00:00Z"))
    await store.write(emptyDoc(), null)
    expect(files.has(DATA_PATH)).toBe(true)
    expect(JSON.parse(files.get(DATA_PATH)!.body).meta.lastSnapshot).toBeUndefined()
    expect(log).toHaveBeenCalledWith("Snapshot failed", "BlobUnknownError")
    fail.put = undefined
    const { doc, etag } = await store.read()
    addPlayer(doc)
    await store.write(doc, etag)
    expect(snapshots(files)).toHaveLength(1)
  })

  it("does not fail the write when listing or deleting old snapshots fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const key of ["list", "del"] as const) {
      const { client, files, fail } = fakeBlob()
      for (let d = 1; d <= 31; d++) files.set(`${SNAPSHOT_PREFIX}2026-10-${String(d).padStart(2, "0")}.json`, { body: "{}", etag: "x" })
      fail[key] = true
      await expect(new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)).resolves.toBeTruthy()
      expect(files.has(DATA_PATH)).toBe(true)
    }
    expect(log).toHaveBeenCalledWith("Snapshot prune failed", "BlobUnknownError")
  })

  it("never logs error messages or tokens", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, mocks } = fakeBlob()
    mocks.put.mockRejectedValueOnce(new Error("token vercel_blob_rw_SECRET failed"))
    await new BlobStore(client, at("2026-11-15T10:00:00Z")).write(emptyDoc(), null)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|token/)
  })
})
