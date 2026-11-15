import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { authed, readJson } from "@/lib/api/handler"
import { setMatchPlayed } from "@/lib/repo"
import { parseMatchPatch, parseUuid } from "@/lib/validation"

/** Records a saved match as played (feeding history scoring) or un-records it. */
export const PATCH = authed<{ id: string }>(async ({ request, supabase, params }) => {
  const id = parseUuid(params.id)
  const parsed = parseMatchPatch(await readJson(request))
  if (!id || !parsed.ok) throw new ApiError(400, "invalid_request")
  const match = await setMatchPlayed(supabase, id, parsed.value)
  if (!match) throw new ApiError(404, "not_found")
  return NextResponse.json(match)
})
