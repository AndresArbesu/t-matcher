"use client"

import { useEffect, useState } from "react"
import { AuthGate, type AuthClient } from "@/components/auth-gate"
import { Scheduler } from "@/components/scheduler"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { translations } from "@/lib/translations"

export default function TennisScheduler() {
  const [language, setLanguage] = useState<"en" | "es">("es")
  const [isDarkMode, setIsDarkMode] = useState(true)
  const t = translations[language]

  // The browser client is created after mount so a missing configuration is reported, not thrown during render.
  const [auth, setAuth] = useState<AuthClient | null>(null)
  const [configError, setConfigError] = useState(false)
  const [origin, setOrigin] = useState("")
  const [linkFailed, setLinkFailed] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
    setLinkFailed(new URLSearchParams(window.location.search).has("auth_error"))
    try {
      setAuth(createClient().auth as unknown as AuthClient)
    } catch {
      setConfigError(true)
    }
  }, [])

  const mutedText = isDarkMode ? "text-slate-400" : "text-slate-600"

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isDarkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"
      }`}
    >
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold">{t.title}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`flex items-center gap-2 ${
                isDarkMode
                  ? "bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
                  : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
              }`}
            >
              {isDarkMode ? "☀️ Light" : "🌙 Dark"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setLanguage(language === "en" ? "es" : "en")}
              className={`flex items-center gap-2 ${
                isDarkMode
                  ? "bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700"
                  : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
              }`}
            >
              {language === "en" ? "🇪🇸 Español" : "🇺🇸 English"}
            </Button>
          </div>
        </div>

        {linkFailed && (
          <p role="alert" className={`mb-4 text-sm ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
            {t.authLinkFailed}
          </p>
        )}

        {configError ? (
          <p role="alert" className={isDarkMode ? "text-red-400" : "text-red-600"}>
            {t.notConfigured}
          </p>
        ) : !auth ? (
          <p className={mutedText}>{t.loading}</p>
        ) : (
          <AuthGate auth={auth} labels={t.auth} isDarkMode={isDarkMode} redirectTo={`${origin}/auth/callback`}>
            <Scheduler language={language} isDarkMode={isDarkMode} />
          </AuthGate>
        )}
      </div>
    </div>
  )
}
