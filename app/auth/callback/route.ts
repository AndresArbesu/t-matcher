import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

/** Magic-link landing: exchanges the PKCE code for a session cookie, then returns home. Never redirects elsewhere. */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url)
  const code = searchParams.get("code")

  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return NextResponse.redirect(`${origin}/`)
    } catch {
      // fall through to the generic failure redirect
    }
  }
  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
