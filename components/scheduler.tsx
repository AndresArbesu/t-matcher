"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { MatchRecordingForm } from "@/components/match-recording-form"
import { MatchHistoryDisplay } from "@/components/match-history-display"
import { api, ClientApiError } from "@/lib/client-api"
import { hydrateDraft, regenerateUnlocked, toDraftPayload, withLocks, type DraftMatch } from "@/lib/draft"
import { MatchAnalyzer } from "@/lib/match-analyzer"
import { translations } from "@/lib/translations"
import type { MatchHistory, Player, SavedMatch, SavedSession } from "@/lib/types"
import { MAX_SKILL, MIN_SKILL } from "@/lib/validation"

const SKILL_LEVELS = Array.from({ length: MAX_SKILL - MIN_SKILL + 1 }, (_, i) => MIN_SKILL + i)
const DEFAULT_SKILL = 2

interface SchedulerProps {
  language: "en" | "es"
  isDarkMode: boolean
}

/** Stored as a code so the message is translated at render time, following the language toggle. */
type Notice = { kind: "error"; code: string } | { kind: "success"; key: "scheduleSaved" | "selectionSaved" }

function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function Scheduler({ language, isDarkMode }: SchedulerProps) {
  const t = translations[language]

  const [players, setPlayers] = useState<Player[]>([])
  const [matchHistory, setMatchHistory] = useState<MatchHistory[]>([])
  const [baseState, setBaseState] = useState<"loading" | "ready" | "error">("loading")
  const [baseError, setBaseError] = useState<string>("")
  const [newPlayerName, setNewPlayerName] = useState("")
  const [newPlayerSkill, setNewPlayerSkill] = useState(DEFAULT_SKILL)

  const [sessionDate, setSessionDate] = useState(todayLocal)
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "error">("loading")
  const [sessionReload, setSessionReload] = useState(0)
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<DraftMatch[][]>([])
  const [savedMatches, setSavedMatches] = useState<SavedMatch[]>([])

  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const codeOf = (error: unknown): string => (error instanceof ClientApiError ? error.code : "server_error")
  const errorText = (code: string): string => t.errors[code as keyof typeof t.errors] ?? t.errors.server_error
  const fail = (error: unknown) => setNotice({ kind: "error", code: codeOf(error) })

  const loadBase = useCallback(async () => {
    setBaseState("loading")
    try {
      const [loadedPlayers, loadedHistory] = await Promise.all([api.listPlayers(), api.listHistory()])
      setPlayers(loadedPlayers)
      setMatchHistory(loadedHistory)
      setBaseState("ready")
    } catch (error) {
      setBaseError(codeOf(error))
      setBaseState("error")
    }
  }, [])

  useEffect(() => {
    void loadBase()
  }, [loadBase])

  /** Replaces the editable state with what the server has stored for the session. */
  const applySession = (session: SavedSession | null, knownPlayers = players, knownHistory = matchHistory) => {
    const analyzer = new MatchAnalyzer(knownHistory, knownPlayers, { referenceDate: sessionDate })
    const draft = session ? hydrateDraft(session.matches, new Map(knownPlayers.map((p) => [p.id, p])), analyzer) : []
    setSavedMatches(session?.matches ?? [])
    setSelectedPlayers(new Set(session?.participants ?? []))
    setDrafts(draft.length > 0 ? [draft] : [])
  }

  useEffect(() => {
    if (baseState !== "ready") return
    let cancelled = false
    setSessionState("loading")
    api
      .getSession(sessionDate)
      .then(({ session }) => {
        if (cancelled) return
        applySession(session)
        setSessionState("ready")
        // A failed load for an earlier (e.g. half-typed) date must not outlive a successful one
        setNotice((current) => (current?.kind === "error" ? null : current))
      })
      .catch((error) => {
        if (cancelled) return
        setSessionState("error")
        fail(error)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseState, sessionDate, sessionReload])

  const activePlayers = players.filter((p) => p.active)
  const visibleForSelection = players.filter((p) => p.active || selectedPlayers.has(p.id))

  const addPlayer = async (event: FormEvent) => {
    event.preventDefault()
    if (!newPlayerName.trim()) return
    setNotice(null)
    try {
      const player = await api.createPlayer({ name: newPlayerName.trim(), skill_level: newPlayerSkill })
      setPlayers((current) => [...current, player])
      setNewPlayerName("")
      setNewPlayerSkill(DEFAULT_SKILL)
    } catch (error) {
      fail(error)
    }
  }

  const removePlayer = async (playerId: string) => {
    setNotice(null)
    try {
      await api.deactivatePlayer(playerId)
      setPlayers((current) => current.map((p) => (p.id === playerId ? { ...p, active: false } : p)))
      if (selectedPlayers.has(playerId)) {
        const next = new Set(selectedPlayers)
        next.delete(playerId)
        setSelectedPlayers(next)
        setDrafts([])
      }
    } catch (error) {
      fail(error)
    }
  }

  // Any change to the selection makes generated schedules stale.
  const changeSelection = (next: Set<string>) => {
    setSelectedPlayers(next)
    setDrafts([])
  }

  const togglePlayerSelection = (playerId: string) => {
    const next = new Set(selectedPlayers)
    if (next.has(playerId)) next.delete(playerId)
    else next.add(playerId)
    changeSelection(next)
  }

  const selectAllPlayers = () => changeSelection(new Set(activePlayers.map((p) => p.id)))
  const clearAllSelections = () => changeSelection(new Set())

  const generateSuggestions = () => {
    const chosen = players.filter((p) => selectedPlayers.has(p.id))
    if (chosen.length < 4 || chosen.length % 4 !== 0) return

    setIsLoading(true)
    setNotice(null)
    try {
      const analyzer = new MatchAnalyzer(matchHistory, players, { referenceDate: sessionDate })
      const arrangements = analyzer.generateCompleteArrangements(chosen, 3)
      setDrafts(arrangements.map((arrangement) => withLocks(arrangement.matches)))
    } catch (error) {
      console.error("Error generating suggestions:", error)
      fail(error)
    } finally {
      setIsLoading(false)
    }
  }

  /** Repeats are counted in sessions (played dates), so this never says anything about days. */
  const formatSessionsAgo = (sessions: number): string => {
    if (sessions < 1) return t.never
    if (sessions === 1) return t.lastSession
    return t.sessionsAgo(sessions)
  }

  const getScoreColor = (score: number): string => {
    if (score < 100) return "bg-green-100 text-green-800"
    if (score < 500) return "bg-yellow-100 text-yellow-800"
    if (score < 1000) return "bg-orange-100 text-orange-800"
    return "bg-red-100 text-red-800"
  }

  const toggleMatchLocked = (draftIndex: number, matchIndex: number) => {
    setDrafts((current) =>
      current.map((draft, i) =>
        i === draftIndex ? draft.map((m, j) => (j === matchIndex ? { ...m, locked: !m.locked } : m)) : draft,
      ),
    )
  }

  const regenerateWithFixedMatches = (draftIndex: number) => {
    setNotice(null)
    try {
      const analyzer = new MatchAnalyzer(matchHistory, players, { referenceDate: sessionDate })
      const chosen = players.filter((p) => selectedPlayers.has(p.id))
      const next = regenerateUnlocked(analyzer, chosen, drafts[draftIndex])
      setDrafts(drafts.map((draft, i) => (i === draftIndex ? next : draft)))
    } catch (error) {
      console.error("Error regenerating with fixed matches:", error)
      fail(error)
    }
  }

  const saveSession = async (draft: DraftMatch[], success: "scheduleSaved" | "selectionSaved") => {
    setIsSaving(true)
    setNotice(null)
    try {
      const { session } = await api.saveSession(sessionDate, toDraftPayload([...selectedPlayers], draft))
      applySession(session)
      setNotice({ kind: "success", key: success })
    } catch (error) {
      fail(error)
    } finally {
      setIsSaving(false)
    }
  }

  const setMatchPlayed = async (matchId: string, played: boolean, notes: string) => {
    setPendingMatchId(matchId)
    setNotice(null)
    try {
      await api.setPlayed(matchId, notes.trim() ? { played, notes: notes.trim() } : { played })
      const [{ session }, history] = await Promise.all([api.getSession(sessionDate), api.listHistory()])
      setMatchHistory(history)
      applySession(session, players, history)
    } catch (error) {
      fail(error)
    } finally {
      setPendingMatchId(null)
    }
  }

  if (baseState === "loading") {
    return <p className={isDarkMode ? "text-slate-400" : "text-slate-600"}>{t.loading}</p>
  }

  if (baseState === "error") {
    return (
      <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
        <CardContent className="space-y-4 pt-6">
          <p role="alert" className={isDarkMode ? "text-red-400" : "text-red-600"}>
            {errorText(baseError)}
          </p>
          <Button onClick={() => void loadBase()} className="bg-blue-600 hover:bg-blue-700 text-white">
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const canGenerate = selectedPlayers.size >= 4 && selectedPlayers.size % 4 === 0
  // The page toggles its theme with classes, not the `dark` variant, so the tab text must be set explicitly
  const tabClass = isDarkMode
    ? "text-slate-300 data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100"
    : "text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900"

  // Three columns even at 320px: labels wrap to two lines rather than stacking into three tall rows
  const tabTriggerClass = `${tabClass} min-h-11 min-w-0 whitespace-normal px-1 text-xs leading-tight sm:px-2 sm:text-sm`

  const outlineButton = isDarkMode
    ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
    : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"

  return (
    <div className="space-y-6">
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`p-3 rounded text-sm ${
            notice.kind === "error"
              ? isDarkMode
                ? "bg-red-900/40 text-red-200"
                : "bg-red-50 text-red-800"
              : isDarkMode
                ? "bg-green-900/40 text-green-200"
                : "bg-green-50 text-green-800"
          }`}
        >
          {notice.kind === "error" ? errorText(notice.code) : t[notice.key]}
        </div>
      )}

      <Tabs defaultValue="players" className="space-y-6">
        <TabsList
          className={`grid h-auto w-full grid-cols-3 gap-1 ${
            isDarkMode ? "bg-slate-800 border-slate-600" : "bg-slate-100 border-slate-200"
          }`}
        >
          <TabsTrigger value="players" className={tabTriggerClass}>
            {t.playersAndSuggestions}
          </TabsTrigger>
          <TabsTrigger value="record" className={tabTriggerClass}>
            {t.recordMatch}
          </TabsTrigger>
          <TabsTrigger value="history" className={tabTriggerClass}>
            {t.matchHistory}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="space-y-8">
          {/* Player Management */}
          <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
            <CardHeader>
              <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                {t.allPlayers} ({activePlayers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addPlayer} className="grid grid-cols-1 gap-3 mb-4 sm:flex sm:items-end sm:gap-4">
                <div className="min-w-0 sm:flex-1">
                  <Label htmlFor="playerName" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                    {t.playerName}
                  </Label>
                  <Input
                    id="playerName"
                    value={newPlayerName}
                    onChange={(e) => setNewPlayerName(e.target.value)}
                    placeholder={t.enterPlayerName}
                    className={
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-400"
                        : "bg-white border-slate-300 text-slate-900"
                    }
                  />
                </div>
                <div className="min-w-0">
                  <span id="skillLevelLabel" className={`text-sm font-medium ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                    {t.skillLevel}
                  </span>
                  <div role="radiogroup" aria-labelledby="skillLevelLabel" className="mt-2 grid grid-cols-3 gap-1.5 sm:flex">
                    {SKILL_LEVELS.map((level) => {
                      const on = level === newPlayerSkill
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setNewPlayerSkill(level)}
                          className={`min-h-11 rounded-md border text-sm font-medium sm:min-w-11 ${
                            on
                              ? "bg-blue-600 border-blue-600 text-white"
                              : isDarkMode
                                ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                                : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
                          }`}
                        >
                          {level}
                        </button>
                      )
                    })}
                  </div>
                  <p className={`mt-1 text-xs ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{t.skillHint}</p>
                </div>
                <Button type="submit" className="w-full min-h-11 bg-blue-600 hover:bg-blue-700 text-white sm:w-auto">
                  {t.addPlayer}
                </Button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {activePlayers.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between gap-2 p-2 border rounded ${
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100"
                        : "bg-white border-slate-200 text-slate-900"
                    }`}
                  >
                    <span className="min-w-0 break-words">
                      {player.name} ({t.skillLevel.split(" ")[0]}: {player.skill_level})
                    </span>
                    <Button variant="destructive" size="sm" className="min-h-10" onClick={() => removePlayer(player.id)}>
                      {t.remove}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Player Selection for Weekly Sessions */}
          <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
            <CardHeader>
              <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                {t.selectPlayersWeek} ({selectedPlayers.size} {t.selected})
              </CardTitle>
              <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
                <div className="col-span-2 sm:col-auto">
                  <Label htmlFor="sessionDate" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                    {t.sessionDate}
                  </Label>
                  <Input
                    id="sessionDate"
                    type="date"
                    value={sessionDate}
                    onChange={(e) => e.target.value && setSessionDate(e.target.value)}
                    className={`w-full min-h-11 sm:w-auto ${
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100"
                        : "bg-white border-slate-300 text-slate-900"
                    }`}
                  />
                </div>
                <Button variant="outline" onClick={selectAllPlayers} className={`min-h-11 ${outlineButton}`}>
                  {t.selectAll}
                </Button>
                <Button variant="outline" onClick={clearAllSelections} className={`min-h-11 ${outlineButton}`}>
                  {t.clearAll}
                </Button>
                <Button
                  variant="outline"
                  disabled={isSaving || sessionState !== "ready"}
                  onClick={() => void saveSession([], "selectionSaved")}
                  className={`col-span-2 min-h-11 sm:col-auto ${outlineButton}`}
                >
                  {isSaving ? t.saving : t.saveSelection}
                </Button>
                {sessionState === "error" && (
                  <Button
                    variant="outline"
                    onClick={() => setSessionReload((n) => n + 1)}
                    className={`col-span-2 min-h-11 sm:col-auto ${outlineButton}`}
                  >
                    {t.retry}
                  </Button>
                )}
              </div>
              {sessionState === "loading" && (
                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{t.loadingSession}</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {visibleForSelection.map((player) => (
                  <label
                    key={player.id}
                    className={`flex min-h-12 items-center gap-3 p-3 border rounded cursor-pointer transition-colors ${
                      selectedPlayers.has(player.id)
                        ? isDarkMode
                          ? "bg-blue-900/50 border-blue-600 text-slate-100"
                          : "bg-blue-50 border-blue-300 text-slate-900"
                        : isDarkMode
                          ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                          : "bg-white border-slate-200 text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlayers.has(player.id)}
                      onChange={() => togglePlayerSelection(player.id)}
                      className="h-5 w-5 shrink-0"
                    />
                    <span className={`min-w-0 break-words ${selectedPlayers.has(player.id) ? "font-medium" : ""}`}>
                      {player.name} ({t.skillLevel.split(" ")[0]}: {player.skill_level})
                      {!player.active && ` – ${t.inactive}`}
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Enhanced Match Suggestions */}
          <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
            <CardHeader>
              <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                {t.intelligentSuggestions}
              </CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <Button
                  onClick={generateSuggestions}
                  disabled={!canGenerate || isLoading}
                  className={`w-full min-h-11 sm:w-auto ${
                    isDarkMode
                      ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  {isLoading ? t.analyzing : t.generateSuggestions}
                </Button>
                <div className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  {t.basedOnMatches} {matchHistory.length} {matchHistory.length === 1 ? t.historicalMatch : t.historicalMatches}
                </div>
              </div>
              {selectedPlayers.size < 4 && (
                <p className={`text-sm ${isDarkMode ? "text-orange-400" : "text-orange-600"}`}>{t.selectAtLeast4}</p>
              )}
              {selectedPlayers.size >= 4 && selectedPlayers.size % 4 !== 0 && (
                <p className={`text-sm ${isDarkMode ? "text-red-400" : "text-red-600"}`}>{t.selectMultipleOf4}</p>
              )}
            </CardHeader>
            <CardContent>
              {canGenerate && (
                <div className="space-y-4 sm:space-y-6">
                  {drafts.length > 0 && (
                    <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{t.lockHint}</p>
                  )}
                  {drafts.map((draft, draftIndex) => (
                    <div
                      key={draftIndex}
                      className={`p-3 sm:p-6 border-2 rounded-lg ${
                        isDarkMode ? "bg-slate-700 border-slate-500" : "bg-slate-50 border-slate-300"
                      }`}
                    >
                      <div className="flex flex-wrap justify-between items-center gap-2 mb-3 sm:mb-4">
                        <h3 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                          #{draftIndex + 1}
                          {draftIndex === 0 && drafts.length > 1 && ` ${t.best}`}
                        </h3>
                        <Badge className={getScoreColor(draft.reduce((sum, m) => sum + m.totalScore, 0))}>
                          {t.score}: {draft.reduce((sum, m) => sum + m.totalScore, 0)}
                        </Badge>
                      </div>

                      <div className="grid gap-3 sm:gap-4">
                        {draft.map((match, matchIndex) => (
                          <div
                            key={matchIndex}
                            className={`p-3 sm:p-4 border rounded-lg ${
                              match.locked
                                ? isDarkMode
                                  ? "bg-green-900/20 border-green-600"
                                  : "bg-green-50 border-green-300"
                                : isDarkMode
                                  ? "bg-slate-800 border-slate-600"
                                  : "bg-white border-slate-200"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
                              <h4 className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                                {t.match} {matchIndex + 1}
                                {match.locked && (
                                  <span
                                    className={`ml-2 text-xs px-2 py-1 rounded font-bold ${
                                      isDarkMode ? "bg-green-800 text-green-200" : "bg-green-100 text-green-800"
                                    }`}
                                  >
                                    {t.fixedBadge}
                                  </span>
                                )}
                              </h4>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  aria-label={`${t.lockMatch} ${matchIndex + 1}`}
                                  checked={match.locked}
                                  onChange={() => toggleMatchLocked(draftIndex, matchIndex)}
                                  className="h-5 w-5"
                                />
                                {t.lockShort}
                              </label>
                            </div>
                            <p className={`mb-3 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                              {t.skillDiff}: {match.skillDifference} | {t.lastRepeat}:{" "}
                              {formatSessionsAgo(match.analysis?.lastPlayedSessions ?? -1)}
                            </p>

                            <div className="grid grid-cols-2 gap-3 sm:gap-4">
                              <div className="min-w-0 break-words">
                                <h5 className={`font-medium ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>
                                  {t.team1}
                                </h5>
                                {match.team1.map((p) => (
                                  <p key={p.id} className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                    {p.name} ({t.skillLevel.split(" ")[0]}: {p.skill_level})
                                  </p>
                                ))}
                                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                  {t.total}: {match.team1[0].skill_level + match.team1[1].skill_level}
                                </p>
                              </div>
                              <div className="min-w-0 break-words">
                                <h5 className={`font-medium ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
                                  {t.team2}
                                </h5>
                                {match.team2.map((p) => (
                                  <p key={p.id} className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                    {p.name} ({t.skillLevel.split(" ")[0]}: {p.skill_level})
                                  </p>
                                ))}
                                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                  {t.total}: {match.team2[0].skill_level + match.team2[1].skill_level}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 pt-4 border-t border-slate-600 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {draft.some((m) => m.locked) && (
                          <Button
                            onClick={() => regenerateWithFixedMatches(draftIndex)}
                            disabled={isLoading}
                            className="h-auto min-h-11 w-full whitespace-normal bg-green-600 text-white hover:bg-green-700 sm:w-auto"
                          >
                            {t.regenerate}
                          </Button>
                        )}
                        <Button
                          onClick={() => void saveSession(draft, "scheduleSaved")}
                          disabled={isSaving || sessionState !== "ready"}
                          className="min-h-11 w-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-600 sm:w-auto"
                        >
                          {isSaving ? t.saving : t.saveSchedule}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Algorithm Explanation */}
          <Card className={`py-0 ${isDarkMode ? "bg-slate-800 border-slate-600 text-slate-100" : "bg-white border-slate-200"}`}>
            <details className="group">
            <summary
              className={`flex min-h-12 cursor-pointer items-center px-6 font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}
            >
              {t.howAlgorithmWorks}
            </summary>
            <CardContent className="space-y-4 pb-6">
              <div>
                <h4 className={`font-semibold mb-2 ${isDarkMode ? "text-green-400" : "text-green-600"}`}>
                  {t.scoringSystem}
                </h4>
                <div className={`text-sm space-y-1 ml-4 ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  <p>
                    <strong>{t.skillBalance}</strong> {t.skillBalanceDesc}
                  </p>
                  <p>
                    <strong>{t.rivalPairRepetition}</strong> {t.rivalPairDesc}
                  </p>
                  <p>
                    <strong>{t.individualRivalRepetition}</strong> {t.individualRivalDesc}
                  </p>
                  <p>
                    <strong>{t.ownPairRepetition}</strong> {t.ownPairDesc}
                  </p>
                  <p>
                    <strong>{t.recentPlayPenalty}</strong> {t.recentPlayDesc}
                  </p>
                </div>
              </div>

              <div>
                <h4 className={`font-semibold mb-2 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>
                  {t.priorityOrder}
                </h4>
                <div className={`text-sm space-y-1 ml-4 ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  <p>
                    <strong>{t.priority1}</strong> {t.priority1Desc}
                  </p>
                  <p>
                    <strong>{t.priority2}</strong> {t.priority2Desc}
                  </p>
                  <p>
                    <strong>{t.priority3}</strong> {t.priority3Desc}
                  </p>
                  <p>
                    <strong>{t.priority4}</strong> {t.priority4Desc}
                  </p>
                  <p>
                    <strong>{t.special}</strong> {t.specialDesc}
                  </p>
                </div>
              </div>

              <div className={`p-3 rounded ${isDarkMode ? "bg-slate-700 text-slate-300" : "bg-slate-50 text-slate-700"}`}>
                <p className="text-sm">
                  <strong>{t.example}</strong> {t.exampleDesc}
                </p>
                <p className="text-sm mt-2">{t.capsDesc}</p>
                <p className="text-sm mt-2">{t.samplingDesc}</p>
              </div>
            </CardContent>
            </details>
          </Card>
        </TabsContent>

        <TabsContent value="record">
          <MatchRecordingForm
            players={players}
            matches={savedMatches}
            t={t}
            pendingId={pendingMatchId}
            onSetPlayed={(id, played, notes) => void setMatchPlayed(id, played, notes)}
          />
        </TabsContent>

        <TabsContent value="history">
          <MatchHistoryDisplay
            players={players}
            matchHistory={matchHistory}
            t={t}
            isDarkMode={isDarkMode}
            onUnrecord={(id) => void setMatchPlayed(id, false, "")}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
