"use client"

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ClientApiError, api } from "@/lib/client-api"

export interface AuthLabels {
  loading: string
  title: string
  passcode: string
  enter: string
  wrongPasscode: string
  networkFailed: string
  loginFailed: string
  sessionFailed: string
  signOut: string
  downloadBackup: string
}

interface AuthGateProps {
  labels: AuthLabels
  isDarkMode: boolean
  children: ReactNode
}

type Status = "loading" | "signedOut" | "signedIn" | "error"

export function AuthGate({ labels, isDarkMode, children }: AuthGateProps) {
  const [status, setStatus] = useState<Status>("loading")
  const [passcode, setPasscode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .checkSession()
      .then(() => !cancelled && setStatus("signedIn"))
      .catch((error) => {
        if (cancelled) return
        setStatus(error instanceof ClientApiError && error.status === 401 ? "signedOut" : "error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await api.login(passcode)
      setPasscode("")
      setStatus("signedIn")
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 401) setMessage(labels.wrongPasscode)
      else if (error instanceof ClientApiError && error.code === "network") setMessage(labels.networkFailed)
      else setMessage(labels.loginFailed)
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    try {
      await api.logout()
    } finally {
      setStatus("signedOut")
    }
  }

  const mutedText = isDarkMode ? "text-slate-400" : "text-slate-600"
  const inputClass = isDarkMode
    ? "bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-400"
    : "bg-white border-slate-300 text-slate-900"
  const outlineClass = isDarkMode
    ? "bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
    : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"

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
          <Button asChild variant="outline" size="sm" className={outlineClass}>
            <a href="/api/export" download>
              {labels.downloadBackup}
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void signOut()} className={outlineClass}>
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
      <CardContent>
        <form onSubmit={signIn} className="space-y-4">
          <div>
            <Label htmlFor="auth-passcode" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
              {labels.passcode}
            </Label>
            <Input
              id="auth-passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className={inputClass}
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !passcode}
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
          >
            {labels.enter}
          </Button>

          {message && (
            <p role="alert" className={`text-sm ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
              {message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
