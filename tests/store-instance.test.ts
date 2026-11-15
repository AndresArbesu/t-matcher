import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BlobStore } from "@/lib/blob-store"
import { FileStore } from "@/lib/file-store"
import { getStore, resetStoreForTests } from "@/lib/store-instance"

beforeEach(() => resetStoreForTests())
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetStoreForTests()
})

describe("getStore", () => {
  it("uses Blob when a read-write token is configured", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test")
    expect(getStore()).toBeInstanceOf(BlobStore)
  })

  it("uses Blob on Vercel too", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test")
    vi.stubEnv("VERCEL", "1")
    expect(getStore()).toBeInstanceOf(BlobStore)
  })

  it("falls back to the local file only off Vercel without a token", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "")
    vi.stubEnv("VERCEL", "")
    expect(getStore()).toBeInstanceOf(FileStore)
  })

  it("fails loudly on Vercel without a credential, logging no secret, and never falls back to a file", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "")
    vi.stubEnv("VERCEL", "1")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => getStore()).toThrow()
    expect(log).toHaveBeenCalledWith("Blob storage is not configured")
    expect(() => getStore()).toThrow()
  })
})
