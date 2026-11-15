import { BlobError, BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob"
import { errorName } from "./api/errors"
import { StoreConflictError,emptyDoc, parseDoc, type Doc, type DocStore } from "./store"

export const DATA_PATH = "t-matcher/data.json"
export const SNAPSHOT_PREFIX = "t-matcher/snapshots/"
export const SNAPSHOTS_KEPT = 30

/**
 * A lost race shows up as a precondition failure (stale etag) or, when several writers hit the
 * same etag at once, as a generic BlobError saying the conditional request conflicted.
 */
function isWriteConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true
  return error instanceof BlobError && /conflicting operation/i.test(error.message)
}

/** The four @vercel/blob functions the store uses, injectable so the store is testable without a network. */
export interface BlobClient {
  get: typeof get
  put: typeof put
  list: typeof list
  del: typeof del
}

const realClient: BlobClient = { get, put, list, del }

/**
 * The document lives in one private Blob. Writes are conditional on the etag read
 * earlier (`ifMatch`), reads bypass the CDN cache. After the first write of each UTC
 * day a copy is saved under snapshots/ and only the newest 30 copies are kept.
 */
export class BlobStore implements DocStore {
  constructor(
    private readonly client: BlobClient = realClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<{ doc: Doc; etag: string | null }> {
    const result = await this.client.get(DATA_PATH, { access: "private", useCache: false })
    if (!result) return { doc: emptyDoc(), etag: null }
    if (result.statusCode !== 200) throw new Error("Unexpected blob response")
    const doc = parseDoc(JSON.parse(await new Response(result.stream).text()))
    // Reads answer with a weak etag (W/"..."); a conditional write (ifMatch) only accepts the strong form.
    return { doc, etag: result.blob.etag.replace(/^W\//, "") }
  }

  async write(doc: Doc, etag: string | null): Promise<string> {
    const today = this.now().toISOString().slice(0, 10)
    let toWrite = doc
    let snapshotted = false
    if (doc.meta.lastSnapshot !== today) {
      // The snapshot goes first so the document that records it is never ahead of the copy.
      const candidate: Doc = { ...doc, meta: { ...doc.meta, lastSnapshot: today } }
      try {
        await this.client.put(`${SNAPSHOT_PREFIX}${today}.json`, JSON.stringify(candidate), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json",
        })
        toWrite = candidate
        snapshotted = true
      } catch (error) {
        console.error("Snapshot failed", errorName(error))
      }
    }
    const newEtag = await this.putDocument(toWrite, etag)
    if (snapshotted) await this.prune()
    return newEtag
  }

  private async putDocument(doc: Doc, etag: string | null): Promise<string> {
    const body = JSON.stringify(doc)
    try {
      const result = await this.client.put(DATA_PATH, body, {
        access: "private",
        contentType: "application/json",
        ...(etag === null ? { allowOverwrite: false } : { allowOverwrite: true, ifMatch: etag }),
      })
      return result.etag
    } catch (error) {
      if (isWriteConflict(error)) throw new StoreConflictError()
      if (etag === null && (await this.exists())) throw new StoreConflictError()
      throw error
    }
  }

  /** Used to recognise "already exists" on a first write without depending on the SDK's error code. */
  private async exists(): Promise<boolean> {
    try {
      return (await this.client.get(DATA_PATH, { access: "private", useCache: false })) !== null
    } catch {
      return false
    }
  }

  private async prune(): Promise<void> {
    try {
      const names: string[] = []
      let cursor: string | undefined
      do {
        const page = await this.client.list({ prefix: SNAPSHOT_PREFIX, cursor })
        names.push(...page.blobs.map((b) => b.pathname))
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
      const stale = names.sort().reverse().slice(SNAPSHOTS_KEPT)
      if (stale.length > 0) await this.client.del(stale)
    } catch (error) {
      console.error("Snapshot prune failed", errorName(error))
    }
  }
}
