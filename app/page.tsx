"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { MatchRecordingForm } from "@/components/match-recording-form"
import { MatchHistoryDisplay } from "@/components/match-history-display"
import { MatchAnalyzer, type ScoredSuggestion, type Arrangement } from "@/lib/match-analyzer"
import type { Player, MatchHistory } from "@/lib/types"

const translations = {
  en: {
    title: "Paddle Match Scheduler",
    playersAndSuggestions: "Players & Suggestions",
    recordMatch: "Record Match",
    matchHistory: "Match History",
    allPlayers: "All Players",
    playerName: "Player Name",
    enterPlayerName: "Enter player name",
    skillLevel: "Skill Level (1-5)",
    addPlayer: "Add Player",
    remove: "Remove",
    selectPlayersWeek: "Select Players for This Week",
    selected: "selected",
    selectAll: "Select All",
    clearAll: "Clear All",
    selectedPlayers: "Selected players:",
    intelligentSuggestions: "Intelligent Match Suggestions",
    analyzing: "Analyzing...",
    generateSuggestions: "Generate Suggestions",
    basedOnMatches: "Based on",
    historicalMatches: "historical matches",
    selectAtLeast4: "Select at least 4 players above to generate match suggestions.",
    selectAtLeast4Generate: "Select at least 4 players to generate match suggestions.",
    selectMultipleOf4: "Select a multiple of 4 players (4, 8, 12, 16, etc.) to generate match suggestions.",
    playersNotMultipleOf4: "Number of selected players must be a multiple of 4 for optimal match arrangements.",
    match: "Match",
    score: "Score",
    recentlyPlayed: "Recently Played",
    skillDiff: "Skill Diff",
    last: "Last",
    team1: "Team 1",
    team2: "Team 2",
    total: "Total",
    rivalPairsPlayed: "Rival pairs played:",
    individualRivals: "Individual rivals:",
    ownPairsPlayed: "Own pairs played:",
    daysSinceLast: "Days since last:",
    howAlgorithmWorks: "How the Algorithm Works",
    scoringSystem: "🎯 Scoring System (Lower = Better)",
    skillBalance: "1. Skill Balance (Primary):",
    skillBalanceDesc: "Minimizes skill difference between teams",
    rivalPairRepetition: "2. Rival Pair Repetition:",
    rivalPairDesc: "+200 points for each time this exact rival matchup was played",
    individualRivalRepetition: "3. Individual Rival Repetition:",
    individualRivalDesc: "+100 points for each individual opponent repetition",
    ownPairRepetition: "4. Own Pair Repetition:",
    ownPairDesc: "+50 points for each time teammates played together",
    recentPlayPenalty: "5. Recent Play Penalty:",
    recentPlayDesc: "+500 points if played within last 7 days",
    priorityOrder: "📊 Priority Order",
    priority1: "1st:",
    priority1Desc: "Least skill difference between teams",
    priority2: "2nd:",
    priority2Desc: "Avoid repeated rival pairs (same 4 players)",
    priority3: "3rd:",
    priority3Desc: "Avoid repeated individual opponents",
    priority4: "4th:",
    priority4Desc: "Avoid repeated partnerships",
    special: "Special:",
    specialDesc: "Recently played matches (last week) get heavy penalty",
    example: "Example:",
    exampleDesc:
      "A match with 2-point skill difference, no repetitions = Score 2. A match with 0-point skill difference but played last week = Score 500+.",
    never: "Never",
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: "days ago",
  },
  es: {
    title: "Programador de Partidos de Padel",
    playersAndSuggestions: "Jugadores y Sugerencias",
    recordMatch: "Registrar Partido",
    matchHistory: "Historial de Partidos",
    allPlayers: "Todos los Jugadores",
    playerName: "Nombre del Jugador",
    enterPlayerName: "Ingresa el nombre del jugador",
    skillLevel: "Nivel de Habilidad (1-5)",
    addPlayer: "Agregar Jugador",
    remove: "Eliminar",
    selectPlayersWeek: "Seleccionar Jugadores para Esta Semana",
    selected: "seleccionados",
    selectAll: "Seleccionar Todos",
    clearAll: "Limpiar Todo",
    selectedPlayers: "Jugadores seleccionados:",
    intelligentSuggestions: "Sugerencias Inteligentes de Partidos",
    analyzing: "Analizando...",
    generateSuggestions: "Generar Sugerencias",
    basedOnMatches: "Basado en",
    historicalMatches: "partidos históricos",
    selectAtLeast4: "Selecciona al menos 4 jugadores arriba para generar sugerencias de partidos.",
    selectAtLeast4Generate: "Selecciona al menos 4 jugadores para generar sugerencias de partidos.",
    selectMultipleOf4:
      "Selecciona un múltiplo de 4 jugadores (4, 8, 12, 16, etc.) para generar sugerencias de partidos.",
    playersNotMultipleOf4:
      "El número de jugadores seleccionados debe ser un múltiplo de 4 para arreglos óptimos de partidos.",
    match: "Partido",
    score: "Puntuación",
    recentlyPlayed: "Jugado Recientemente",
    skillDiff: "Dif. Habilidad",
    last: "Último",
    team1: "Equipo 1",
    team2: "Equipo 2",
    total: "Total",
    rivalPairsPlayed: "Parejas rivales jugadas:",
    individualRivals: "Rivales individuales:",
    ownPairsPlayed: "Parejas propias jugadas:",
    daysSinceLast: "Días desde el último:",
    howAlgorithmWorks: "Cómo Funciona el Algoritmo",
    scoringSystem: "🎯 Sistema de Puntuación (Menor = Mejor)",
    skillBalance: "1. Balance de Habilidad (Primario):",
    skillBalanceDesc: "Minimiza la diferencia de habilidad entre equipos",
    rivalPairRepetition: "2. Repetición de Pareja Rival:",
    rivalPairDesc: "+200 puntos por cada vez que se jugó este enfrentamiento rival exacto",
    individualRivalRepetition: "3. Repetición de Rival Individual:",
    individualRivalDesc: "+100 puntos por cada repetición de oponente individual",
    ownPairRepetition: "4. Repetición de Pareja Propia:",
    ownPairDesc: "+50 puntos por cada vez que los compañeros jugaron juntos",
    recentPlayPenalty: "5. Penalización por Juego Reciente:",
    recentPlayDesc: "+500 puntos si se jugó en los últimos 7 días",
    priorityOrder: "📊 Orden de Prioridad",
    priority1: "1ro:",
    priority1Desc: "Menor diferencia de habilidad entre equipos",
    priority2: "2do:",
    priority2Desc: "Evitar parejas rivales repetidas (mismos 4 jugadores)",
    priority3: "3ro:",
    priority3Desc: "Evitar oponentes individuales repetidos",
    priority4: "4to:",
    priority4Desc: "Evitar asociaciones repetidas",
    special: "Especial:",
    specialDesc: "Los partidos jugados recientemente (última semana) reciben penalización fuerte",
    example: "Ejemplo:",
    exampleDesc:
      "Un partido con 2 puntos de diferencia de habilidad, sin repeticiones = Puntuación 2. Un partido con 0 puntos de diferencia de habilidad pero jugado la semana pasada = Puntuación 500+.",
    never: "Nunca",
    today: "Hoy",
    yesterday: "Ayer",
    daysAgo: "días atrás",
  },
}

export default function TennisScheduler() {
  const [language, setLanguage] = useState<"en" | "es">("es")
  const [isDarkMode, setIsDarkMode] = useState(true)
  const t = translations[language]

  const [players, setPlayers] = useState<Player[]>([])
  const [newPlayerName, setNewPlayerName] = useState("")
  const [newPlayerSkill, setNewPlayerSkill] = useState(3)
  const [suggestions, setSuggestions] = useState<(ScoredSuggestion | Arrangement)[]>([])
  const [matchHistory, setMatchHistory] = useState<MatchHistory[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set())
  const [fixedMatches, setFixedMatches] = useState<Map<string, any>>(new Map()) // arrangementIndex-matchIndex -> match

  useEffect(() => {
    loadPlayers()
    loadMatchHistory()
  }, [])

  const loadPlayers = async () => {
    try {
      const response = await fetch("/api/players")
      if (!response.ok) {
        throw new Error("Failed to load players")
      }
      const data = await response.json()
      setPlayers(data || [])
    } catch (error) {
      console.error("Error loading players:", error)
    }
  }

  const loadMatchHistory = async () => {
    try {
      const response = await fetch("/api/match-history")
      if (!response.ok) {
        throw new Error("Failed to load match history")
      }
      const data = await response.json()
      setMatchHistory(data || [])
    } catch (error) {
      console.error("Error loading match history:", error)
    }
  }

  const addPlayer = async () => {
    if (!newPlayerName.trim()) return

    try {
      const response = await fetch("/api/players", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newPlayerName.trim(),
          skill_level: newPlayerSkill,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to add player")
      }

      const newPlayer = await response.json()
      setPlayers([...players, newPlayer])
      setNewPlayerName("")
      setNewPlayerSkill(3)
    } catch (error) {
      console.error("Error adding player:", error)
    }
  }

  const removePlayer = async (playerId: string) => {
    try {
      const response = await fetch(`/api/players/${playerId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to remove player")
      }

      setPlayers(players.filter((p) => p.id !== playerId))
    } catch (error) {
      console.error("Error removing player:", error)
    }
  }

  const togglePlayerSelection = (playerId: string) => {
    const newSelected = new Set(selectedPlayers)
    if (newSelected.has(playerId)) {
      newSelected.delete(playerId)
    } else {
      newSelected.add(playerId)
    }
    setSelectedPlayers(newSelected)
  }

  const selectAllPlayers = () => {
    setSelectedPlayers(new Set(players.map((p) => p.id)))
  }

  const clearAllSelections = () => {
    setSelectedPlayers(new Set())
  }

  const generateSuggestions = () => {
    const activePlayers = players.filter((p) => selectedPlayers.has(p.id))

    if (activePlayers.length < 4) return

    setIsLoading(true)

    try {
      const analyzer = new MatchAnalyzer(matchHistory, players)

      if (activePlayers.length % 4 === 0) {
        // Generate complete arrangements (multiple matches per arrangement)
        const arrangements = analyzer.generateCompleteArrangements(activePlayers, 3) // Generate 3 different arrangements
        setSuggestions(arrangements)
      } else {
        // Generate individual match suggestions for non-multiples of 4
        const scoredSuggestions = analyzer.generateScoredSuggestions(activePlayers)
        setSuggestions(scoredSuggestions.slice(0, 8))
      }
    } catch (error) {
      console.error("Error generating suggestions:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleMatchRecorded = () => {
    loadMatchHistory()
    console.log("Match recorded successfully!")
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

  const toggleMatchFixed = (arrangementIndex: number, matchIndex: number, match: any) => {
    const key = `${arrangementIndex}-${matchIndex}`
    const newFixedMatches = new Map(fixedMatches)

    if (newFixedMatches.has(key)) {
      newFixedMatches.delete(key)
    } else {
      newFixedMatches.set(key, match)
    }

    setFixedMatches(newFixedMatches)
  }

  const regenerateWithFixedMatches = (arrangementIndex: number) => {
    const arrangement = suggestions[arrangementIndex] as Arrangement
    if (!arrangement) return

    setIsLoading(true)

    try {
      const analyzer = new MatchAnalyzer(matchHistory, players)
      const activePlayers = players.filter((p) => selectedPlayers.has(p.id))

      const fixedMatchesForArrangement: { match: any; originalIndex: number }[] = []
      const nonFixedMatches: { match: any; originalIndex: number }[] = []
      const usedPlayerIds = new Set<string>()
      const usedInNewMatches = new Set<string>()

      arrangement.matches.forEach((match, matchIndex) => {
        const key = `${arrangementIndex}-${matchIndex}`
        if (fixedMatches.has(key)) {
          fixedMatchesForArrangement.push({ match, originalIndex: matchIndex })
          // Mark these players as used
          match.team1.forEach((player: Player) => usedPlayerIds.add(player.id))
          match.team2.forEach((player: Player) => usedPlayerIds.add(player.id))
        } else {
          nonFixedMatches.push({ match, originalIndex: matchIndex })
        }
      })

      // Get remaining players (only those not in fixed matches)
      const remainingPlayers = activePlayers.filter((player) => !usedPlayerIds.has(player.id))

      // Generate new matches for remaining players only
      const newMatches: any[] = []
      if (remainingPlayers.length >= 4 && remainingPlayers.length % 4 === 0) {
        const numNewMatches = remainingPlayers.length / 4
        const availablePlayers = [...remainingPlayers]
        analyzer.shuffleArray(availablePlayers)

        for (let i = 0; i < numNewMatches; i++) {
          const playersLeft = availablePlayers.filter((p) => !usedInNewMatches.has(p.id))

          if (playersLeft.length < 4) break

          // Generate best match from remaining players
          const possibleMatches: any[] = []
          for (let a = 0; a < playersLeft.length; a++) {
            for (let b = a + 1; b < playersLeft.length; b++) {
              for (let c = 0; c < playersLeft.length; c++) {
                if (c === a || c === b) continue
                for (let d = c + 1; d < playersLeft.length; d++) {
                  if (d === a || d === b) continue

                  const team1: [Player, Player] = [playersLeft[a], playersLeft[b]]
                  const team2: [Player, Player] = [playersLeft[c], playersLeft[d]]
                  const scoredMatch = analyzer.scoreMatch(team1, team2)
                  possibleMatches.push(scoredMatch)
                }
              }
            }
          }

          possibleMatches.sort((a, b) => a.totalScore - b.totalScore)
          const bestMatch = possibleMatches[0]

          if (bestMatch) {
            newMatches.push(bestMatch)
            bestMatch.team1.forEach((p: Player) => usedInNewMatches.add(p.id))
            bestMatch.team2.forEach((p: Player) => usedInNewMatches.add(p.id))
          }
        }
      }

      const reconstructedMatches: any[] = new Array(arrangement.matches.length)

      // Place fixed matches in their original positions
      fixedMatchesForArrangement.forEach(({ match, originalIndex }) => {
        reconstructedMatches[originalIndex] = match
      })

      // Place new matches in non-fixed positions
      let newMatchIndex = 0
      nonFixedMatches.forEach(({ originalIndex }) => {
        if (newMatchIndex < newMatches.length) {
          reconstructedMatches[originalIndex] = newMatches[newMatchIndex]
          newMatchIndex++
        }
      })

      // Calculate total score
      const totalScore = reconstructedMatches.reduce((sum, match) => sum + (match?.totalScore || 0), 0)

      const newArrangement: Arrangement = {
        matches: reconstructedMatches.filter((match) => match !== undefined),
        totalScore,
        usedPlayers: new Set([...usedPlayerIds, ...Array.from(usedInNewMatches || [])]),
      }

      // Update the specific arrangement
      const newSuggestions = [...suggestions]
      newSuggestions[arrangementIndex] = newArrangement
      setSuggestions(newSuggestions)
    } catch (error) {
      console.error("Error regenerating with fixed matches:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isDarkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"
      }`}
    >
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">{t.title}</h1>
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

        <Tabs defaultValue="players" className="space-y-6">
          <TabsList
            className={`grid w-full grid-cols-3 ${
              isDarkMode ? "bg-slate-800 border-slate-600" : "bg-slate-100 border-slate-200"
            }`}
          >
            <TabsTrigger
              value="players"
              className={isDarkMode ? "data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100" : ""}
            >
              {t.playersAndSuggestions}
            </TabsTrigger>
            <TabsTrigger
              value="record"
              className={isDarkMode ? "data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100" : ""}
            >
              {t.recordMatch}
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className={isDarkMode ? "data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100" : ""}
            >
              {t.matchHistory}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="players" className="space-y-8">
            {/* Player Management */}
            <Card className={isDarkMode ? "bg-slate-800 border-slate-600" : "bg-white border-slate-200"}>
              <CardHeader>
                <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                  {t.allPlayers} ({players.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
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
                  <div className="w-32">
                    <Label htmlFor="skillLevel" className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                      {t.skillLevel}
                    </Label>
                    <Input
                      id="skillLevel"
                      type="number"
                      min="1"
                      max="5"
                      value={newPlayerSkill}
                      onChange={(e) => setNewPlayerSkill(Number.parseInt(e.target.value))}
                      className={
                        isDarkMode
                          ? "bg-slate-700 border-slate-600 text-slate-100"
                          : "bg-white border-slate-300 text-slate-900"
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={addPlayer}
                      className={
                        isDarkMode
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      }
                    >
                      {t.addPlayer}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {players.map((player) => (
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
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllPlayers}
                    className={
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                        : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
                    }
                  >
                    {t.selectAll}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllSelections}
                    className={
                      isDarkMode
                        ? "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                        : "bg-white border-slate-300 text-slate-900 hover:bg-slate-50"
                    }
                  >
                    {t.clearAll}
                  </Button>
                </div>
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
                  {players.map((player) => (
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
                        className="w-4 h-4"
                      />
                      <span className={selectedPlayers.has(player.id) ? "font-medium" : ""}>
                        {player.name} ({t.skillLevel.split(" ")[0]}: {player.skill_level})
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
                    disabled={selectedPlayers.size < 4 || selectedPlayers.size % 4 !== 0 || isLoading}
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
                    {selectedPlayers.size % 4 === 0
                      ? // Display complete arrangements
                        suggestions.map((arrangement, arrangementIndex) => (
                          <div
                            key={arrangementIndex}
                            className={`p-6 border-2 rounded-lg ${
                              isDarkMode ? "bg-slate-700 border-slate-500" : "bg-slate-50 border-slate-300"
                            }`}
                          >
                            <div className="flex justify-between items-center mb-4">
                              <h3 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                                {language === "en" ? "Arrangement" : "Arreglo"} {arrangementIndex + 1}
                              </h3>
                              <Badge className={getScoreColor((arrangement as Arrangement).totalScore)}>
                                {t.score}: {(arrangement as Arrangement).totalScore}
                              </Badge>
                            </div>

                            <div className="grid gap-4">
                              {(() => {
                                const fixedMatchesInArrangement: { match: any; matchIndex: number }[] = []
                                const nonFixedMatchesInArrangement: { match: any; matchIndex: number }[] = []
                                ;(arrangement as Arrangement).matches?.forEach((match, matchIndex) => {
                                  const key = `${arrangementIndex}-${matchIndex}`
                                  if (fixedMatches.has(key)) {
                                    fixedMatchesInArrangement.push({ match, matchIndex })
                                  } else {
                                    nonFixedMatchesInArrangement.push({ match, matchIndex })
                                  }
                                })

                                return [...fixedMatchesInArrangement, ...nonFixedMatchesInArrangement].map(
                                  ({ match, matchIndex }) => (
                                    <div
                                      key={matchIndex}
                                      className={`p-4 border rounded-lg ${
                                        fixedMatches.has(`${arrangementIndex}-${matchIndex}`)
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
                                            checked={fixedMatches.has(`${arrangementIndex}-${matchIndex}`)}
                                            onChange={() => toggleMatchFixed(arrangementIndex, matchIndex, match)}
                                            className="w-4 h-4"
                                          />
                                          <h4
                                            className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}
                                          >
                                            {t.match} {matchIndex + 1}
                                            {fixedMatches.has(`${arrangementIndex}-${matchIndex}`) && (
                                              <span
                                                className={`ml-2 text-xs px-2 py-1 rounded font-bold ${
                                                  isDarkMode
                                                    ? "bg-green-800 text-green-200"
                                                    : "bg-green-100 text-green-800"
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
                                          <h5
                                            className={`font-medium ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}
                                          >
                                            {t.team1}
                                          </h5>
                                          <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                            {match.team1?.[0]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                            {match.team1?.[0]?.skill_level})
                                          </p>
                                          <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                            {match.team1?.[1]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                            {match.team1?.[1]?.skill_level})
                                          </p>
                                          <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                            {t.total}:{" "}
                                            {(match.team1?.[0]?.skill_level ?? 0) +
                                              (match.team1?.[1]?.skill_level ?? 0)}
                                          </p>
                                        </div>
                                        <div>
                                          <h5 className={`font-medium ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
                                            {t.team2}
                                          </h5>
                                          <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                            {match.team2?.[0]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                            {match.team2?.[0]?.skill_level})
                                          </p>
                                          <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                            {match.team2?.[1]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                            {match.team2?.[1]?.skill_level})
                                          </p>
                                          <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                            {t.total}:{" "}
                                            {(match.team2?.[0]?.skill_level ?? 0) +
                                              (match.team2?.[1]?.skill_level ?? 0)}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ),
                                )
                              })()}
                            </div>

                            {Array.from(fixedMatches.keys()).some((key) => key.startsWith(`${arrangementIndex}-`)) && (
                              <div className="mt-4 pt-4 border-t border-slate-600">
                                <Button
                                  onClick={() => regenerateWithFixedMatches(arrangementIndex)}
                                  disabled={isLoading}
                                  className={
                                    isDarkMode
                                      ? "bg-green-600 hover:bg-green-700 text-white"
                                      : "bg-green-600 hover:bg-green-700 text-white"
                                  }
                                >
                                  {isLoading
                                    ? language === "en"
                                      ? "Regenerating..."
                                      : "Regenerando..."
                                    : language === "en"
                                      ? "Regenerate with Fixed Matches"
                                      : "Regenerar con Partidos Fijos"}
                                </Button>
                              </div>
                            )}
                          </div>
                        ))
                      : // Display individual match suggestions for non-multiples of 4
                        suggestions.map((suggestion, index) => (
                          <div
                            key={index}
                            className={`p-4 border rounded-lg ${
                              isDarkMode ? "bg-slate-700 border-slate-600" : "bg-white border-slate-200"
                            }`}
                          >
                            <div className="flex justify-between items-center mb-3">
                              <div className="flex items-center gap-2">
                                <h3 className={`font-semibold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
                                  {t.match} {index + 1}
                                </h3>
                                <Badge className={getScoreColor((suggestion as ScoredSuggestion).totalScore)}>
                                  {t.score}: {(suggestion as ScoredSuggestion).totalScore}
                                </Badge>
                                {(suggestion as ScoredSuggestion).recentlyPlayed && (
                                  <Badge variant="destructive">{t.recentlyPlayed}</Badge>
                                )}
                              </div>
                              <div className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                {t.skillDiff}: {(suggestion as ScoredSuggestion).skillDifference} | {t.last}:{" "}
                                {formatDaysAgo((suggestion as ScoredSuggestion).analysis?.lastPlayedDays ?? -1)}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-3">
                              <div>
                                <h4 className={`font-medium ${isDarkMode ? "text-blue-400" : "text-blue-600"}`}>
                                  {t.team1}
                                </h4>
                                <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                  {(suggestion as ScoredSuggestion).team1?.[0]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                  {(suggestion as ScoredSuggestion).team1?.[0]?.skill_level})
                                </p>
                                <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                  {(suggestion as ScoredSuggestion).team1?.[1]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                  {(suggestion as ScoredSuggestion).team1?.[1]?.skill_level})
                                </p>
                                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                  {t.total}:{" "}
                                  {((suggestion as ScoredSuggestion).team1?.[0]?.skill_level ?? 0) +
                                    ((suggestion as ScoredSuggestion).team1?.[1]?.skill_level ?? 0)}
                                </p>
                              </div>
                              <div>
                                <h4 className={`font-medium ${isDarkMode ? "text-red-400" : "text-red-600"}`}>
                                  {t.team2}
                                </h4>
                                <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                  {(suggestion as ScoredSuggestion).team2?.[0]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                  {(suggestion as ScoredSuggestion).team2?.[0]?.skill_level})
                                </p>
                                <p className={isDarkMode ? "text-slate-200" : "text-slate-800"}>
                                  {(suggestion as ScoredSuggestion).team2?.[1]?.name} ({t.skillLevel.split(" ")[0]}:{" "}
                                  {(suggestion as ScoredSuggestion).team2?.[1]?.skill_level})
                                </p>
                                <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                                  {t.total}:{" "}
                                  {((suggestion as ScoredSuggestion).team2?.[0]?.skill_level ?? 0) +
                                    ((suggestion as ScoredSuggestion).team2?.[1]?.skill_level ?? 0)}
                                </p>
                              </div>
                            </div>

                            {/* Analysis Details */}
                            <div
                              className={`text-xs grid grid-cols-2 gap-2 pt-2 border-t ${
                                isDarkMode ? "text-slate-400 border-slate-600" : "text-slate-600 border-slate-200"
                              }`}
                            >
                              <div>
                                {t.rivalPairsPlayed} {(suggestion as ScoredSuggestion).analysis?.rivalPairCount ?? 0}
                              </div>
                              <div>
                                {t.individualRivals}{" "}
                                {(suggestion as ScoredSuggestion).analysis?.individualRivalCount ?? 0}
                              </div>
                              <div>
                                {t.ownPairsPlayed} {(suggestion as ScoredSuggestion).analysis?.ownPairCount ?? 0}
                              </div>
                              <div>
                                {t.daysSinceLast}{" "}
                                {formatDaysAgo((suggestion as ScoredSuggestion).analysis?.lastPlayedDays ?? -1)}
                              </div>
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
                <CardTitle className={isDarkMode ? "text-slate-100" : "text-slate-900"}>
                  {t.howAlgorithmWorks}
                </CardTitle>
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

                <div
                  className={`p-3 rounded ${isDarkMode ? "bg-slate-700 text-slate-300" : "bg-slate-50 text-slate-700"}`}
                >
                  <p className="text-sm">
                    <strong>{t.example}</strong> {t.exampleDesc}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="record">
            <MatchRecordingForm players={players} onMatchRecorded={handleMatchRecorded} />
          </TabsContent>

          <TabsContent value="history">
            <MatchHistoryDisplay players={players} matchHistory={matchHistory} onRefresh={loadMatchHistory} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
