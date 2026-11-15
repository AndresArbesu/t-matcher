import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { authed, readJson } from "@/lib/api/handler"
import { createPlayer, listPlayers } from "@/lib/repo"
import { parsePlayerCreate } from "@/lib/validation"

export const GET = authed(async ({ supabase }) => NextResponse.json(await listPlayers(supabase)))

export const POST = authed(async ({ request, supabase }) => {
  const parsed = parsePlayerCreate(await readJson(request))
  if (!parsed.ok) throw new ApiError(400, "invalid_request")
  return NextResponse.json(await createPlayer(supabase, parsed.value), { status: 201 })
})
