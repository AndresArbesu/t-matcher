"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import type { Player, MatchHistory } from "@/lib/types"

interface MatchHistoryWithPlayers extends MatchHistory {
  players: {
    [key: string]: Player
  }
}

interface MatchHistoryDisplayProps {
  players: Player[]
  matchHistory: MatchHistory[]
  onRefresh: () => void
}

export function MatchHistoryDisplay({ players, matchHistory, onRefresh }: MatchHistoryDisplayProps) {
  const [filteredHistory, setFilteredHistory] = useState<MatchHistoryWithPlayers[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [playerFilter, setPlayerFilter] = useState("")
  const [sortBy, setSortBy] = useState("recent")

  const supabase = createClient()

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
    if (playerFilter) {
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

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getTeamPlayers = (match: MatchHistoryWithPlayers, teamNumber: 1 | 2) => {
    if (teamNumber === 1) {
      return [match.players[match.team1_player1_id], match.players[match.team1_player2_id]].filter(Boolean)
    } else {
      return [match.players[match.team2_player1_id], match.players[match.team2_player2_id]].filter(Boolean)
    }
  }

  const deleteMatch = async (matchId: string) => {
    if (!confirm("Are you sure you want to delete this match?")) return

    const { error } = await supabase.from("match_history").delete().eq("id", matchId)

    if (error) {
      console.error("Error deleting match:", error)
      alert("Error deleting match. Please try again.")
    } else {
      onRefresh()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match History ({filteredHistory.length} matches)</CardTitle>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              placeholder="Search players or notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="playerFilter">Filter by Player</Label>
            <Select value={playerFilter} onValueChange={setPlayerFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All players" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All players</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="sortBy">Sort by</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {filteredHistory.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              {matchHistory.length === 0 ? "No matches recorded yet." : "No matches match your filters."}
            </p>
            {matchHistory.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Record your first match using the "Record Match" tab.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredHistory.map((match) => {
              const team1Players = getTeamPlayers(match, 1)
              const team2Players = getTeamPlayers(match, 2)
              const daysAgo = Math.floor((Date.now() - new Date(match.played_at).getTime()) / (1000 * 60 * 60 * 24))

              return (
                <div key={match.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">Match on {formatDate(match.played_at)}</h3>
                      {daysAgo <= 7 && <Badge variant="secondary">Recent</Badge>}
                      {daysAgo === 0 && <Badge variant="default">Today</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {daysAgo === 0 ? "Today" : `${daysAgo} days ago`}
                      </span>
                      <Button variant="destructive" size="sm" onClick={() => deleteMatch(match.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 mb-3">
                    <div>
                      <h4 className="font-medium text-blue-600 mb-2">Team 1</h4>
                      {team1Players.map((player) => (
                        <div key={player.id} className="flex justify-between">
                          <span>{player.name}</span>
                          <span className="text-muted-foreground">Skill: {player.skill_level}</span>
                        </div>
                      ))}
                      <div className="text-sm text-muted-foreground mt-1">
                        Total Skill: {team1Players.reduce((sum, p) => sum + p.skill_level, 0)}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-red-600 mb-2">Team 2</h4>
                      {team2Players.map((player) => (
                        <div key={player.id} className="flex justify-between">
                          <span>{player.name}</span>
                          <span className="text-muted-foreground">Skill: {player.skill_level}</span>
                        </div>
                      ))}
                      <div className="text-sm text-muted-foreground mt-1">
                        Total Skill: {team2Players.reduce((sum, p) => sum + p.skill_level, 0)}
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground mb-2">
                    Skill Difference:{" "}
                    {Math.abs(
                      team1Players.reduce((sum, p) => sum + p.skill_level, 0) -
                        team2Players.reduce((sum, p) => sum + p.skill_level, 0),
                    )}
                  </div>

                  {match.notes && (
                    <div className="mt-3 p-2 bg-muted rounded">
                      <span className="text-sm font-medium">Notes: </span>
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
