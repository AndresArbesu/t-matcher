"use client"

import { useState } from "react"
import { AuthGate } from "@/components/auth-gate"
import { Scheduler } from "@/components/scheduler"
import { Button } from "@/components/ui/button"
import { translations } from "@/lib/translations"

export default function TennisScheduler() {
  const [language, setLanguage] = useState<"en" | "es">("es")
  const [isDarkMode, setIsDarkMode] = useState(true)
  const t = translations[language]

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

        <AuthGate labels={t.auth} isDarkMode={isDarkMode}>
          <Scheduler language={language} isDarkMode={isDarkMode} />
        </AuthGate>
      </div>
    </div>
  )
}
