import { NextResponse } from "next/server"
import { open } from "@/lib/api/handler"
import { SESSION_COOKIE } from "@/lib/auth"

export const POST = open(async () => {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
})
