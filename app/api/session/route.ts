import { NextResponse } from "next/server"
import { ApiError } from "@/lib/api/errors"
import { open } from "@/lib/api/handler"
import { isAuthenticated } from "@/lib/auth"

/** Tells the page whether its cookie is a valid session. Touches no data. */
export const GET = open(async ({ request }) => {
  if (!isAuthenticated(request)) throw new ApiError(401, "unauthorized")
  return NextResponse.json({ ok: true })
})
