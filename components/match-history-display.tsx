"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { daysSince, formatPlayedAt } from "@/lib/history"
import type { translations } from "@/lib/translations"
import type { Player, MatchHistory } from "@/lib/types"

interface MatchHistoryWithPlayers extends MatchHistory {
  players: {
    [key: string]: Player
  }
}

interface MatchHistoryDisplayProps {
  players: Player[]
  matchHistory: MatchHistory[]
  t: (typeof translations)[keyof typeof translations]
  isDarkMode: boolean
  /** Un-records a match: it leaves the history but stays on its saved session. */
  onUnrecord: (matchId: string) => void
}

export function MatchHistoryDisplay({ players, matchHistory, t, isDarkMode, onUnrecord }: MatchHistoryDisplayProps) {
  const [filteredHistory, setFilteredHistory] = useState<MatchHistoryWithPlayers[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [playerFilter, setPlayerFilter] = useState("")
  const [sortBy, setSortBy] = useState("recent")

  // The page themes with classes rather than the `dark` variant, so every colour is chosen here
  const muted = isDarkMode ? "text-slate-400" : "text-slate-600"
  const cardClass = isDarkMode
    ? "bg-slate-800 border-slate-600 text-slate-100"
    : "bg-white border-slate-200 text-slate-900"
  const fieldClass = isDarkMode
    ? "bg-slate-700 border-slate-600 text-slate-100 placeholder:text-slate-400"
    : "bg-white border-slate-300 text-slate-900"

  // Process match history with player details
  useEffect(() => {
    const processedHistory = matchHistory.map((match) => {
      const playerMap: { [key: string]: Player } = {}

      // Map all player IDs to player objects
      const allPlayerIds = [match.player1_id, match.player2_id, match.player3_id, match.player4_id]
      allPlayerIds.forEach((playerId) => {
        const player = players.find((p) => p.id === playerId)
        if (player) {
          playerMap[playerId] = player
        }
      })

      return {
        ...match,
        players: playerMap,
      }
    })

    // Apply filters
    let filtered = processedHistory

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (match) =>
          Object.values(match.players).some((player) => player.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (match.notes && match.notes.toLowerCase().includes(searchTerm.toLowerCase())),
      )
    }

    // Player filter
    if (playerFilter && playerFilter !== "all") {
      filtered = filtered.filter((match) =>
        [match.player1_id, match.player2_id, match.player3_id, match.player4_id].includes(playerFilter),
      )
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "recent":
          return new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
        case "oldest":
          return new Date(a.played_at).getTime() - new Date(b.played_at).getTime()
        default:
          return 0
      }
    })

    setFilteredHistory(filtered)
  }, [matchHistory, players, searchTerm, playerFilter, sortBy])

  const getTeamPlayers = (match: MatchHistoryWithPlayers, teamNumber: 1 | 2) => {
    if (teamNumber === 1) {
      return [match.players[match.team1_player1_id], match.players[match.team1_player2_id]].filter(Boolean)
    } else {
      return [match.players[match.team2_player1_id], match.players[match.team2_player2_id]].filter(Boolean)
    }
  }

  const deleteMatch = (matchId: string) => {
    if (!confirm(t.confirmRemove)) return
    onUnrecord(matchId)
  }

  return (
    <Card className={cardClass}>
      <CardHeader>
        <CardTitle>
          {t.historyTitle} ({filteredHistory.length} {filteredHistory.length === 1 ? t.matchWord : t.matchesWord})
        </CardTitle>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="search">{t.search}</Label>
            <Input
              id="search"
              placeholder={t.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <Label htmlFor="playerFilter">{t.filterByPlayer}</Label>
            <Select value={playerFilter} onValueChange={setPlayerFilter}>
              <SelectTrigger className={fieldClass}>
                <SelectValue placeholder={t.allPlayersOption} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allPlayersOption}</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="sortBy">{t.sortBy}</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className={fieldClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t.mostRecent}</SelectItem>
                <SelectItem value="oldest">{t.oldestFirst}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {filteredHistory.length === 0 ? (
          <div className="text-center py-8">
            <p className={muted}>{matchHistory.length === 0 ? t.noMatchesYet : t.noMatchesFilter}</p>
            {matchHistory.length === 0 && <p className={`text-sm mt-2 ${muted}`}>{t.historyHint}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredHistory.map((match) => {
              const team1Players = getTeamPlayers(match, 1)
              const team2Players = getTeamPlayers(match, 2)
              const daysAgo = daysSince(match.played_at)

              return (
                <div key={match.id} className={`border rounded-lg p-4 ${isDarkMode ? "border-slate-600" : "border-slate-200"}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {t.matchOn} {formatPlayedAt(match.played_at, t.dateLocale)}
                      </h3>
                      {daysAgo <= 7 && <Badge variant="secondary">{t.recent}</Badge>}
                      {daysAgo === 0 && <Badge variant="default">{t.today}</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${muted}`}>
                        {daysAgo === 0 ? t.today : `${daysAgo} ${t.daysAgo}`}
                      </span>
                      <Button variant="destructive" size="sm" onClick={() => deleteMatch(match.id)}>
                        {t.remove}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-3">
                    <div>
                      <h4 className={`font-medium mb-2 ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>{t.team1}</h4>
                      {team1Players.map((player) => (
                        <div key={player.id} className="flex justify-between">
                          <span>{player.name}</span>
                          <span className={muted}>
                            {t.skill}: {player.skill_level}
                          </span>
                        </div>
                      ))}
                      <div className={`text-sm mt-1 ${muted}`}>
                        {t.totalSkill}: {team1Players.reduce((sum, p) => sum + p.skill_level, 0)}
                      </div>
                    </div>

                    <div>
                      <h4 className={`font-medium mb-2 ${isDarkMode ? "text-red-400" : "text-red-600"}`}>{t.team2}</h4>
                      {team2Players.map((player) => (
                        <div key={player.id} className="flex justify-between">
                          <span>{player.name}</span>
                          <span className={muted}>
                            {t.skill}: {player.skill_level}
                          </span>
                        </div>
                      ))}
                      <div className={`text-sm mt-1 ${muted}`}>
                        {t.totalSkill}: {team2Players.reduce((sum, p) => sum + p.skill_level, 0)}
                      </div>
                    </div>
                  </div>

                  <div className={`text-sm mb-2 ${muted}`}>
                    {t.skillDifference}:{" "}
                    {Math.abs(
                      team1Players.reduce((sum, p) => sum + p.skill_level, 0) -
                        team2Players.reduce((sum, p) => sum + p.skill_level, 0),
                    )}
                  </div>

                  {match.notes && (
                    <div className={`mt-3 p-2 rounded ${isDarkMode ? "bg-slate-700" : "bg-slate-100"}`}>
                      <span className="text-sm font-medium">{t.notes}: </span>
                      <span className="text-sm">{match.notes}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
