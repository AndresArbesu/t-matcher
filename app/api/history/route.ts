import { NextResponse } from "next/server"
import { authed } from "@/lib/api/handler"
import { listHistory } from "@/lib/repo"

export const GET = authed(async ({ supabase }) => NextResponse.json(await listHistory(supabase)))
