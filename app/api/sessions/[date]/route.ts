import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { authed, readJson } from "@/lib/api/handler"
import { countOwnedPlayers, getSession, saveSessionDraft } from "@/lib/repo"
import { parseSessionDate, parseSessionDraft } from "@/lib/validation"

export const GET = authed<{ date: string }>(async ({ supabase, params }) => {
  const date = parseSessionDate(params.date)
  if (!date) throw new ApiError(400, "invalid_request")
  return NextResponse.json({ session: await getSession(supabase, date) })
})

/** Saves the draft for a date: selected participants plus ordered matches with lock states. */
export const PUT = authed<{ date: string }>(async ({ request, supabase, params }) => {
  const date = parseSessionDate(params.date)
  const parsed = parseSessionDraft(await readJson(request))
  if (!date || !parsed.ok) throw new ApiError(400, "invalid_request")

  // Every referenced player must be one of the caller's own (RLS hides all others).
  const owned = await countOwnedPlayers(supabase, parsed.value.participants)
  if (owned !== parsed.value.participants.length) throw new ApiError(422, "invalid_players")

  await saveSessionDraft(supabase, date, parsed.value)
  return NextResponse.json({ session: await getSession(supabase, date) })
})
