import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { authed, readJson } from "@/lib/api/handler"
import { updatePlayer } from "@/lib/repo"
import { parsePlayerPatch, parseUuid } from "@/lib/validation"

export const PATCH = authed<{ id: string }>(async ({ request, supabase, params }) => {
  const id = parseUuid(params.id)
  const parsed = parsePlayerPatch(await readJson(request))
  if (!id || !parsed.ok) throw new ApiError(400, "invalid_request")
  const player = await updatePlayer(supabase, id, parsed.value)
  if (!player) throw new ApiError(404, "not_found")
  return NextResponse.json(player)
})

/** Players are never hard-deleted: history keeps referring to them. DELETE deactivates. */
export const DELETE = authed<{ id: string }>(async ({ supabase, params }) => {
  const id = parseUuid(params.id)
  if (!id) throw new ApiError(400, "invalid_request")
  const player = await updatePlayer(supabase, id, { active: false })
  if (!player) throw new ApiError(404, "not_found")
  return NextResponse.json(player)
})
