"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import type { Player } from "@/lib/types"

interface MatchRecordingFormProps {
  players: Player[]
  onMatchRecorded: () => void
}

export function MatchRecordingForm({ players, onMatchRecorded }: MatchRecordingFormProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [team1Player1, setTeam1Player1] = useState("")
  const [team1Player2, setTeam1Player2] = useState("")
  const [team2Player1, setTeam2Player1] = useState("")
  const [team2Player2, setTeam2Player2] = useState("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const supabase = createClient()

  const availablePlayers = players.filter((p) => !selectedPlayers.includes(p.id))
  const canFormTeams = selectedPlayers.length === 4

  const handlePlayerSelect = (playerId: string, position: number) => {
    const newSelected = [...selectedPlayers]
    newSelected[position] = playerId
    setSelectedPlayers(newSelected.filter(Boolean))

    // Reset team assignments when players change
    setTeam1Player1("")
    setTeam1Player2("")
    setTeam2Player1("")
    setTeam2Player2("")
  }

  const getSelectedPlayersList = () => {
    return selectedPlayers.map((id) => players.find((p) => p.id === id)).filter(Boolean) as Player[]
  }

  const validateTeamAssignments = () => {
    const teamPlayers = [team1Player1, team1Player2, team2Player1, team2Player2]
    const uniqueTeamPlayers = new Set(teamPlayers)

    return (
      teamPlayers.every((id) => id && selectedPlayers.includes(id)) &&
      uniqueTeamPlayers.size === 4 &&
      team1Player1 !== team1Player2 &&
      team2Player1 !== team2Player2
    )
  }

  const handleSubmit = async () => {
    if (!validateTeamAssignments()) return

    setIsSubmitting(true)

    try {
      const { error } = await supabase.from("match_history").insert([
        {
          player1_id: selectedPlayers[0],
          player2_id: selectedPlayers[1],
          player3_id: selectedPlayers[2],
          player4_id: selectedPlayers[3],
          team1_player1_id: team1Player1,
          team1_player2_id: team1Player2,
          team2_player1_id: team2Player1,
          team2_player2_id: team2Player2,
          notes: notes.trim() || null,
        },
      ])

      if (error) {
        console.error("Error recording match:", error)
        alert("Error recording match. Please try again.")
      } else {
        // Reset form
        setSelectedPlayers([])
        setTeam1Player1("")
        setTeam1Player2("")
        setTeam2Player1("")
        setTeam2Player2("")
        setNotes("")
        onMatchRecorded()
        alert("Match recorded successfully!")
      }
    } catch (error) {
      console.error("Error recording match:", error)
      alert("Error recording match. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (players.length < 4) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Record Match</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Add at least 4 players to record matches.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Match</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Player Selection */}
        <div>
          <Label className="text-base font-semibold">Select 4 Players</Label>
          <div className="grid grid-cols-2 gap-4 mt-2">
            {[0, 1, 2, 3].map((position) => (
              <div key={position}>
                <Label htmlFor={`player-${position}`}>Player {position + 1}</Label>
                <Select
                  value={selectedPlayers[position] || ""}
                  onValueChange={(value) => handlePlayerSelect(value, position)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select player" />
                  </SelectTrigger>
                  <SelectContent>
                    {players
                      .filter((p) => !selectedPlayers.includes(p.id) || selectedPlayers[position] === p.id)
                      .map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name} (Skill: {player.skill_level})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Team Assignment */}
        {canFormTeams && (
          <div>
            <Label className="text-base font-semibold">Team Assignment</Label>
            <div className="grid grid-cols-2 gap-6 mt-2">
              <div className="space-y-3">
                <h4 className="font-medium text-blue-600">Team 1</h4>
                <div>
                  <Label htmlFor="team1-player1">Player 1</Label>
                  <Select value={team1Player1} onValueChange={setTeam1Player1}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                    <SelectContent>
                      {getSelectedPlayersList().map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="team1-player2">Player 2</Label>
                  <Select value={team1Player2} onValueChange={setTeam1Player2}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                    <SelectContent>
                      {getSelectedPlayersList()
                        .filter((p) => p.id !== team1Player1)
                        .map((player) => (
                          <SelectItem key={player.id} value={player.id}>
                            {player.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-medium text-red-600">Team 2</h4>
                <div>
                  <Label htmlFor="team2-player1">Player 1</Label>
                  <Select value={team2Player1} onValueChange={setTeam2Player1}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                    <SelectContent>
                      {getSelectedPlayersList()
                        .filter((p) => p.id !== team1Player1 && p.id !== team1Player2)
                        .map((player) => (
                          <SelectItem key={player.id} value={player.id}>
                            {player.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="team2-player2">Player 2</Label>
                  <Select value={team2Player2} onValueChange={setTeam2Player2}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select player" />
                    </SelectTrigger>
                    <SelectContent>
                      {getSelectedPlayersList()
                        .filter((p) => p.id !== team1Player1 && p.id !== team1Player2 && p.id !== team2Player1)
                        .map((player) => (
                          <SelectItem key={player.id} value={player.id}>
                            {player.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <Label htmlFor="notes">Notes (Optional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about the match..."
            className="mt-1"
          />
        </div>

        {/* Submit Button */}
        <Button onClick={handleSubmit} disabled={!validateTeamAssignments() || isSubmitting} className="w-full">
          {isSubmitting ? "Recording Match..." : "Record Match"}
        </Button>
      </CardContent>
    </Card>
  )
}
