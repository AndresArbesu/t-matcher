import { authed } from "@/lib/api/handler"

/** Downloads the whole document, as a backup the owner can keep or restore from. */
export const GET = authed(async ({ store }) => {
  const { doc } = await store.read()
  const today = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="t-matcher-backup-${today}.json"`,
      "Cache-Control": "no-store",
    },
  })
})
