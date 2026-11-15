"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** The subset of Supabase's auth client the gate uses (injectable for tests). */
export interface AuthClient {
  getSession(): Promise<{ data: { session: { user: { email?: string } } | null }; error?: unknown }>
  onAuthStateChange(cb: (event: string, session: { user: { email?: string } } | null) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
  signInWithOtp(args: { email: string; options: { emailRedirectTo: string } }): Promise<{ error: unknown }>
  verifyOtp(args: { email: string; token: string; type: "email" }): Promise<{ error: unknown }>
  signOut(): Promise<{ error: unknown }>
}

export interface AuthLabels {
  loading: string
  title: string
  email: string
  sendCode: string
  checkEmail: string
  code: string
  verify: string
  sendFailed: string
  verifyFailed: string
  sessionFailed: string
  signedInAs: string
  signOut: string
}

interface AuthGateProps {
  auth: AuthClient
  labels: AuthLabels
  isDarkMode: boolean
  redirectTo: string
  children: ReactNode
}

type Status = "loading" | "signedOut" | "signedIn" | "error"

export function AuthGate({ auth, labels, isDarkMode, redirectTo, children }: AuthGateProps) {
  const [status, setStatus] = useState<Status>("loading")
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const apply = (session: { user: { email?: string } } | null) => {
      setUserEmail(session?.user.email ?? null)
      setStatus(session ? "signedIn" : "signedOut")
    }
    let cancelled = false
    auth
      .getSession()
      .then(({ data }) => !cancelled && apply(data.session))
      .catch(() => !cancelled && setStatus("error"))
    const { data } = auth.onAuthStateChange((_event, session) => apply(session))
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [auth])

  const sendCode = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } })
      if (error) setMessage(labels.sendFailed)
      else setCodeSent(true)
    } catch {
      setMessage(labels.sendFailed)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" })
      if (error) setMessage(labels.verifyFailed)
    } catch {
      setMessage(labels.verifyFailed)
    } finally {
      setBusy(false)
    }
  }

  const mutedText = isDarkMode ? "text-slate-400" : "text-slate-600"
  const inputClass = isDarkMode
    ? "bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-400"
    : "bg-white border-slate-300 text-slate-900"

  if (status === "loading") {
    return <p className={mutedText}>{labels.loading}</p>
  }

  if (status === "error") {
    return (
      <p role="alert" className={isDarkMode ? "text-red-400" : "text-red-600"}>
        {labels.sessionFailed}
      </p>
    )
  }

  if (status === "signedIn") {
    return (
      <div className="space-y-6">
        <div className={`flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end text-sm ${mutedText}`}>
          <span>
            {labels.signedInAs} {userEmail}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void auth.signOut()}
            className={
              isDarkMode
                ? "bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
                : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
            }
          >
            {labels.signOut}
          </Button>
        </div>
        {children}
      </div>
    )
  }

  return (
    <Card className={`max-w-md mx-auto ${isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}`}>
      <CardHeader>
        <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="auth-email" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
            {labels.email}
          </Label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <Button
          onClick={sendCode}
          disabled={busy || !email.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
        >
          {labels.sendCode}
        </Button>

        {codeSent && (
          <div className="space-y-4">
            <p className={`text-sm ${mutedText}`}>{labels.checkEmail}</p>
            <div>
              <Label htmlFor="auth-code" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                {labels.code}
              </Label>
              <Input
                id="auth-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={inputClass}
              />
            </div>
            <Button
              onClick={verify}
              disabled={busy || !code.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
            >
              {labels.verify}
            </Button>
          </div>
        )}

        {message && (
          <p role="alert" className={`text-sm ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
