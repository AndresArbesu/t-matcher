"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { translations } from "@/lib/translations"
import type { Player, SavedMatch } from "@/lib/types"

interface MatchRecordingFormProps {
  players: Player[]
  /** Matches saved on the current dated session; recording one feeds the scoring history. */
  matches: SavedMatch[]
  t: (typeof translations)["en"]
  /** Id of the match currently being saved, to disable its controls. */
  pendingId: string | null
  onSetPlayed: (matchId: string, played: boolean, notes: string) => void
}

export function MatchRecordingForm({ players, matches, t, pendingId, onSetPlayed }: MatchRecordingFormProps) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "?"

  if (matches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.recordMatch}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t.saveFirst}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.recordMatch}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {matches.map((match, index) => {
          const noteId = `notes-${match.id}`
          const pending = pendingId === match.id
          return (
            <div key={match.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">
                  {t.match} {index + 1}
                </h4>
                {match.played && <Badge variant="default">{t.played}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h5 className="font-medium text-blue-600">{t.team1}</h5>
                  {match.team1.map((id) => (
                    <p key={id}>{name(id)}</p>
                  ))}
                </div>
                <div>
                  <h5 className="font-medium text-red-600">{t.team2}</h5>
                  {match.team2.map((id) => (
                    <p key={id}>{name(id)}</p>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor={noteId}>{t.notesOptional}</Label>
                <Textarea
                  id={noteId}
                  value={notes[match.id] ?? match.notes ?? ""}
                  disabled={match.played}
                  onChange={(e) => setNotes({ ...notes, [match.id]: e.target.value })}
                  placeholder={t.notesPlaceholder}
                  className="mt-1"
                />
              </div>
              <Button
                className="w-full"
                variant={match.played ? "outline" : "default"}
                disabled={pending}
                onClick={() => onSetPlayed(match.id, !match.played, notes[match.id] ?? match.notes ?? "")}
              >
                {pending ? t.saving : match.played ? t.undoPlayed : t.markPlayed}
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
