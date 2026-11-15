import { StoreConflictError, emptyDoc, type Doc, type DocStore } from "@/lib/store"

/** In-memory DocStore with the same etag semantics as the real ones, plus conflict injection. */
export class MemoryStore implements DocStore {
  doc: Doc | null = null
  version = 0
  reads = 0
  writes = 0
  private failures = 0
  private beforeWrite: (() => void) | null = null

  get etag(): string | null {
    return this.doc ? `v${this.version}` : null
  }

  /** The next `n` writes throw a conflict regardless of the etag. */
  failNextWrites(n: number): void {
    this.failures = n
  }

  /** Runs once at the start of the next write, e.g. to simulate another writer committing in between. */
  interfereOnce(fn: () => void): void {
    this.beforeWrite = fn
  }

  /** Commits a change as "someone else", bumping the etag. */
  external(fn: (doc: Doc) => void): void {
    const doc = structuredClone(this.doc ?? emptyDoc())
    fn(doc)
    this.doc = doc
    this.version++
  }

  async read() {
    this.reads++
    return { doc: structuredClone(this.doc ?? emptyDoc()), etag: this.etag }
  }

  async write(doc: Doc, etag: string | null): Promise<string> {
    this.writes++
    const hook = this.beforeWrite
    this.beforeWrite = null
    hook?.()
    if (this.failures > 0) {
      this.failures--
      throw new StoreConflictError()
    }
    if (etag !== this.etag) throw new StoreConflictError()
    this.doc = structuredClone(doc)
    this.version++
    return this.etag!
  }
}
