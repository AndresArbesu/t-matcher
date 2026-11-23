import { NextResponse } from "next/server"
import { authed, readJson } from "@/lib/api/handler"
import { addHistoricalMatch, listHistory } from "@/lib/repo"

import { ApiError } from "@/lib/api/errors"
import { parseHistoricalMatch } from "@/lib/validation"

export const GET = authed(async ({ store }) => NextResponse.json(await listHistory(store)))

export const POST = authed(async ({ request, store }) => {
  const parsed = parseHistoricalMatch(await readJson(request))
  if (!parsed.ok) throw new ApiError(400, "invalid_request")
  return NextResponse.json(await addHistoricalMatch(store, parsed.value), { status: 201 })
})
