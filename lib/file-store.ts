import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { StoreConflictError, parseDoc, emptyDoc, type Doc, type DocStore } from "./store"

const hash = (content: string) => createHash("sha256").update(content).digest("hex")

/** Local development store: a JSON file whose etag is the hash of its content. Not for Vercel. */
export class FileStore implements DocStore {
  constructor(private readonly file: string) {}

  private current(): { content: string; etag: string } | null {
    if (!existsSync(this.file)) return null
    const content = readFileSync(this.file, "utf8")
    return { content, etag: hash(content) }
  }

  async read(): Promise<{ doc: Doc; etag: string | null }> {
    const current = this.current()
    if (!current) return { doc: emptyDoc(), etag: null }
    return { doc: parseDoc(JSON.parse(current.content)), etag: current.etag }
  }

  // Compare and write are synchronous, so no other request in this process can interleave.
  async write(doc: Doc, etag: string | null): Promise<string> {
    const current = this.current()
    if ((current?.etag ?? null) !== etag) throw new StoreConflictError()
    const content = JSON.stringify(doc, null, 2)
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, content)
    renameSync(tmp, this.file)
    return hash(content)
  }
}
