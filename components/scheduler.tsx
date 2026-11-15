"use client"

import { useCallback, useEffect, useState } from "react"
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
  const [newPlayerSkill, setNewPlayerSkill] = useState(3)

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
    const analyzer = new MatchAnalyzer(knownHistory, knownPlayers)
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

  const addPlayer = async () => {
    if (!newPlayerName.trim()) return
    setNotice(null)
    try {
      const player = await api.createPlayer({ name: newPlayerName.trim(), skill_level: newPlayerSkill })
      setPlayers((current) => [...current, player])
      setNewPlayerName("")
      setNewPlayerSkill(3)
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
      const analyzer = new MatchAnalyzer(matchHistory, players)
      const arrangements = analyzer.generateCompleteArrangements(chosen, 3)
      setDrafts(arrangements.map((arrangement) => withLocks(arrangement.matches)))
    } catch (error) {
      console.error("Error generating suggestions:", error)
      fail(error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDaysAgo = (days: number): string => {
    if (days < 0) return t.never
    if (days < 1) return t.today
    if (days < 2) return t.yesterday
    return `${Math.floor(days)} ${t.daysAgo}`
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
      const analyzer = new MatchAnalyzer(matchHistory, players)
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
          className={`grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3 ${
            isDarkMode ? "bg-slate-800 border-slate-600" : "bg-slate-100 border-slate-200"
          }`}
        >
          <TabsTrigger
            value="players"
            className={`${tabClass} min-w-0 whitespace-normal`}
          >
            {t.playersAndSuggestions}
          </TabsTrigger>
          <TabsTrigger
            value="record"
            className={`${tabClass} min-w-0 whitespace-normal`}
          >
            {t.recordMatch}
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className={`${tabClass} min-w-0 whitespace-normal`}
          >
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
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3 mb-4 sm:flex sm:gap-4">
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
                <div className="min-w-0 sm:w-32">
                  <Label htmlFor="skillLevel" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                    {t.skillLevel}
                  </Label>
                  <Input
                    id="skillLevel"
                    type="number"
                    min="1"
                    max="10"
                    value={newPlayerSkill}
                    onChange={(e) => setNewPlayerSkill(Number.parseInt(e.target.value))}
                    className={
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100"
                        : "bg-white border-slate-300 text-slate-900"
                    }
                  />
                </div>
                <div className="col-span-2 flex items-end sm:col-auto">
                  <Button onClick={addPlayer} className="w-full bg-blue-600 hover:bg-blue-700 text-white sm:w-auto">
                    {t.addPlayer}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {activePlayers.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between p-2 border rounded ${
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100"
                        : "bg-white border-slate-200 text-slate-900"
                    }`}
                  >
                    <span>
                      {player.name} ({t.skillLevel.split(" ")[0]}: {player.skill_level})
                    </span>
                    <Button variant="destructive" size="sm" onClick={() => removePlayer(player.id)}>
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
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="sessionDate" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                    {t.sessionDate}
                  </Label>
                  <Input
                    id="sessionDate"
                    type="date"
                    value={sessionDate}
                    onChange={(e) => e.target.value && setSessionDate(e.target.value)}
                    className={
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100"
                        : "bg-white border-slate-300 text-slate-900"
                    }
                  />
                </div>
                <Button variant="outline" size="sm" onClick={selectAllPlayers} className={outlineButton}>
                  {t.selectAll}
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllSelections} className={outlineButton}>
                  {t.clearAll}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSaving || sessionState !== "ready"}
                  onClick={() => void saveSession([], "selectionSaved")}
                  className={outlineButton}
                >
                  {isSaving ? t.saving : t.saveSelection}
                </Button>
                {sessionState === "error" && (
                  <Button variant="outline" size="sm" onClick={() => setSessionReload((n) => n + 1)} className={outlineButton}>
                    {t.retry}
                  </Button>
                )}
              </div>
              {sessionState === "loading" && (
                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{t.loadingSession}</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div
                  className={`p-3 rounded text-sm ${
                    isDarkMode ? "bg-blue-900/30 text-blue-200" : "bg-blue-50 text-blue-800"
                  }`}
                >
                  {language === "en"
                    ? "Check the box next to any match to fix it in place. When you regenerate, fixed matches will stay the same while remaining players get reshuffled."
                    : "Marca la casilla junto a cualquier partido para fijarlo en su lugar. Cuando regeneres, los partidos fijos permanecerán igual mientras que los jugadores restantes se mezclarán."}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {visibleForSelection.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center gap-3 p-3 border rounded cursor-pointer transition-colors ${
                      selectedPlayers.has(player.id)
                        ? isDarkMode
                          ? "bg-blue-900/50 border-blue-600 text-slate-100"
                          : "bg-blue-50 border-blue-300 text-slate-900"
                        : isDarkMode
                          ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                          : "bg-white border-slate-200 text-slate-900 hover:bg-slate-50"
                    }`}
                    onClick={() => togglePlayerSelection(player.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlayers.has(player.id)}
                      onChange={() => togglePlayerSelection(player.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4"
                    />
                    <span className={selectedPlayers.has(player.id) ? "font-medium" : ""}>
                      {player.name} ({t.skillLevel.split(" ")[0]}: {player.skill_level})
                      {!player.active && ` – ${t.inactive}`}
                    </span>
                  </div>
                ))}
              </div>
              {selectedPlayers.size > 0 && (
                <div
                  className={`mt-4 p-3 rounded ${
                    isDarkMode ? "bg-blue-900/50 text-blue-200" : "bg-blue-50 text-blue-800"
                  }`}
                >
                  <p className="text-sm">
                    <strong>{t.selectedPlayers}</strong>{" "}
                    {players
                      .filter((p) => selectedPlayers.has(p.id))
                      .map((p) => p.name)
                      .join(", ")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Enhanced Match Suggestions */}
          <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
            <CardHeader>
              <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                {t.intelligentSuggestions}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  onClick={generateSuggestions}
                  disabled={!canGenerate || isLoading}
                  className={
                    isDarkMode
                      ? "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }
                >
                  {isLoading ? t.analyzing : t.generateSuggestions}
                </Button>
                <div className={`text-sm flex items-center ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                  {t.basedOnMatches} {matchHistory.length} {t.historicalMatches}
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
              {selectedPlayers.size < 4 ? (
                <p className={isDarkMode ? "text-slate-400" : "text-slate-600"}>{t.selectAtLeast4Generate}</p>
              ) : selectedPlayers.size % 4 !== 0 ? (
                <p className={isDarkMode ? "text-red-400" : "text-red-600"}>{t.playersNotMultipleOf4}</p>
              ) : (
                <div className="space-y-6">
                  {drafts.map((draft, draftIndex) => (
                    <div
                      key={draftIndex}
                      className={`p-6 border-2 rounded-lg ${
                        isDarkMode ? "bg-slate-700 border-slate-500" : "bg-slate-50 border-slate-300"
                      }`}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <h3 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                          {language === "en" ? "Arrangement" : "Arreglo"} {draftIndex + 1}
                        </h3>
                        <Badge className={getScoreColor(draft.reduce((sum, m) => sum + m.totalScore, 0))}>
                          {t.score}: {draft.reduce((sum, m) => sum + m.totalScore, 0)}
                        </Badge>
                      </div>

                      <div className="grid gap-4">
                        {draft.map((match, matchIndex) => (
                          <div
                            key={matchIndex}
                            className={`p-4 border rounded-lg ${
                              match.locked
                                ? isDarkMode
                                  ? "bg-green-900/20 border-green-600"
                                  : "bg-green-50 border-green-300"
                                : isDarkMode
                                  ? "bg-slate-800 border-slate-600"
                                  : "bg-white border-slate-200"
                            }`}
                          >
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  aria-label={`${t.lockMatch} ${matchIndex + 1}`}
                                  checked={match.locked}
                                  onChange={() => toggleMatchLocked(draftIndex, matchIndex)}
                                  className="w-4 h-4"
                                />
                                <h4 className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                                  {t.match} {matchIndex + 1}
                                  {match.locked && (
                                    <span
                                      className={`ml-2 text-xs px-2 py-1 rounded font-bold ${
                                        isDarkMode ? "bg-green-800 text-green-200" : "bg-green-100 text-green-800"
                                      }`}
                                    >
                                      {language === "en" ? "FIXED" : "FIJO"}
                                    </span>
                                  )}
                                </h4>
                              </div>
                              <div className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                {t.skillDiff}: {match.skillDifference} | {t.last}:{" "}
                                {formatDaysAgo(match.analysis?.lastPlayedDays ?? -1)}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
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
                              <div>
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

                      <div className="mt-4 pt-4 border-t border-slate-600 flex flex-wrap gap-2">
                        {draft.some((m) => m.locked) && (
                          <Button
                            onClick={() => regenerateWithFixedMatches(draftIndex)}
                            disabled={isLoading}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            {language === "en" ? "Regenerate with Fixed Matches" : "Regenerar con Partidos Fijos"}
                          </Button>
                        )}
                        <Button
                          onClick={() => void saveSession(draft, "scheduleSaved")}
                          disabled={isSaving || sessionState !== "ready"}
                          className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-600"
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
          <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
            <CardHeader>
              <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>{t.howAlgorithmWorks}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <p className="text-sm mt-2">{t.samplingDesc}</p>
              </div>
            </CardContent>
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
