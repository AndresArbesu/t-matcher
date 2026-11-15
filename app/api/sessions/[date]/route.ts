import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { authed, readJson } from "@/lib/api/handler"
import { getSession, saveSessionDraft } from "@/lib/repo"
import { parseSessionDate, parseSessionDraft } from "@/lib/validation"

export const GET = authed<{ date: string }>(async ({ store, params }) => {
  const date = parseSessionDate(params.date)
  if (!date) throw new ApiError(400, "invalid_request")
  return NextResponse.json({ session: await getSession(store, date) })
})

/** Saves the draft for a date: selected participants plus ordered matches with lock states. */
export const PUT = authed<{ date: string }>(async ({ request, store, params }) => {
  const date = parseSessionDate(params.date)
  const parsed = parseSessionDraft(await readJson(request))
  if (!date || !parsed.ok) throw new ApiError(400, "invalid_request")
  return NextResponse.json({ session: await saveSessionDraft(store, date, parsed.value) })
})
