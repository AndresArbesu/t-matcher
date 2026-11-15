import path from "node:path"
import { BlobStore } from "./blob-store"
import { FileStore } from "./file-store"
import type { DocStore } from "./store"

let cached: DocStore | undefined

/**
 * Blob when a read-write token is configured; a local file only for development.
 * On Vercel without a credential this throws (a 500 to the caller) instead of
 * silently writing to an ephemeral file system.
 */
export function getStore(): DocStore {
  if (cached) return cached
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cached = new BlobStore()
  } else if (process.env.VERCEL) {
    console.error("Blob storage is not configured")
    throw new Error("Blob storage is not configured")
  } else {
    cached = new FileStore(path.join(process.cwd(), ".data", "store.json"))
  }
  return cached
}

export function resetStoreForTests(): void {
  cached = undefined
}
