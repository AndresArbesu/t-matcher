// End-to-end check over real HTTP against a locally started server (`npm run dev` or `npm start`).
//
//   node scripts/smoke.mjs
//   BASE_URL=http://127.0.0.1:3000 APP_PASSCODE=... node scripts/smoke.mjs
//
// It writes to whatever store the server uses: locally that is .data/store.json, and nothing else.
// It refuses to run against a non-local URL unless ALLOW_REMOTE=1 (it creates real players there).

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "")
const PASSCODE = process.env.APP_PASSCODE || "dev"
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

let host
try {
  host = new URL(BASE_URL).hostname
} catch {
  console.error(`FAIL: BASE_URL is not a URL: ${BASE_URL}`)
  process.exit(1)
}
if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE !== "1") {
  console.error(`REFUSING: ${BASE_URL} is not a local address. Set ALLOW_REMOTE=1 to run against it (this creates data there).`)
  process.exit(1)
}

let cookie = ""
let checks = 0

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function expect(condition, message) {
  checks++
  if (!condition) fail(message)
}

async function call(method, path, { body, authed = true } = {}) {
  const headers = { "Content-Type": "application/json" }
  if (authed && cookie) headers.Cookie = cookie
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
  } catch {
    fail(`cannot reach ${BASE_URL}. Start the app first (npm run dev).`)
  }
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON (e.g. the export is, but errors from a proxy may not be)
  }
  return { status: response.status, json, text, headers: response.headers }
}

const stamp = Date.now().toString(36)
const nameA = `Smoke A ${stamp}`
const nameB = `Smoke B ${stamp}`

// 1. Unauthenticated access is refused.
let r = await call("GET", "/api/players", { authed: false })
expect(r.status === 401, `unauthenticated GET /api/players should be 401, got ${r.status}`)

// 2. Wrong passcode is refused, the right one sets a cookie.
r = await call("POST", "/api/login", { body: { passcode: `${PASSCODE}-wrong` }, authed: false })
expect(r.status === 401, `wrong passcode should be 401, got ${r.status}`)
expect(!r.headers.get("set-cookie"), "a wrong passcode must not set a cookie")

r = await call("POST", "/api/login", { body: { passcode: PASSCODE }, authed: false })
expect(r.status === 200, `login with the passcode should be 200, got ${r.status} (is APP_PASSCODE the same as the server's?)`)
const setCookie = r.headers.get("set-cookie") ?? ""
expect(/^tm_session=/.test(setCookie), "login should set the tm_session cookie")
expect(/httponly/i.test(setCookie), "the session cookie should be HttpOnly")
cookie = setCookie.split(";")[0]

r = await call("GET", "/api/session")
expect(r.status === 200 && r.json?.ok === true, `GET /api/session with the cookie should be ok, got ${r.status}`)

// 3. Players: validation, creation, duplicates.
r = await call("POST", "/api/players", { body: { name: `Smoke bad ${stamp}`, skill_level: 4 } })
expect(r.status === 400, `skill level 4 should be rejected with 400, got ${r.status}`)

r = await call("POST", "/api/players", { body: { name: nameA, skill_level: 3 } })
expect(r.status === 201, `creating player A should be 201, got ${r.status}`)
const players = [r.json]
for (const [name, level] of [[nameB, 2], [`Smoke C ${stamp}`, 1], [`Smoke D ${stamp}`, 3]]) {
  r = await call("POST", "/api/players", { body: { name, skill_level: level } })
  expect(r.status === 201, `creating ${name} should be 201, got ${r.status}`)
  players.push(r.json)
}

r = await call("POST", "/api/players", { body: { name: nameA.toUpperCase(), skill_level: 1 } })
expect(r.status === 409 && r.json?.error === "conflict", `duplicate name (different case) should be 409 conflict, got ${r.status}`)

r = await call("GET", "/api/players")
expect(r.status === 200 && players.every((p) => r.json.some((q) => q.id === p.id)), "the created players should be listed")

// 4. A session draft with a locked match round-trips.
const ids = players.map((p) => p.id)
// A fresh far-future date per run: a played match from an earlier run would otherwise pin its session (409 in_use).
const date = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`
const draft = { participants: ids, matches: [{ team1: [ids[0], ids[1]], team2: [ids[2], ids[3]], locked: true }] }
r = await call("PUT", `/api/sessions/${date}`, { body: draft })
expect(r.status === 200, `saving the draft should be 200, got ${r.status}`)

r = await call("GET", `/api/sessions/${date}`)
const session = r.json?.session
expect(r.status === 200 && session, "the saved session should be readable")
expect(JSON.stringify(session.participants) === JSON.stringify(ids), "participants should round-trip")
expect(session.matches.length === 1 && session.matches[0].locked === true && session.matches[0].played === false, "the locked match should round-trip unplayed")

// 5. Mark it played and see it in history.
const matchId = session.matches[0].id
r = await call("PATCH", `/api/matches/${matchId}`, { body: { played: true, notes: "smoke" } })
expect(r.status === 200 && r.json?.played === true, `marking played should be 200, got ${r.status}`)

r = await call("GET", "/api/history")
expect(r.status === 200 && r.json.some((m) => m.id === matchId && m.played_at === date), "the played match should appear in /api/history")

// 6. The export contains the players.
r = await call("GET", "/api/export")
expect(r.status === 200, `export should be 200, got ${r.status}`)
expect(/attachment; filename="t-matcher-backup-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers.get("content-disposition") ?? ""), "export should be a dated attachment")
expect(r.json?.version === 1 && ids.every((id) => r.json.players.some((p) => p.id === id)), "the export should contain the players")

// 7. Logout clears the cookie.
r = await call("POST", "/api/logout")
expect(r.status === 200, `logout should be 200, got ${r.status}`)
cookie = ""
r = await call("GET", "/api/players", { authed: false })
expect(r.status === 401, "after logout (no cookie) the API should be 401 again")

console.log(`PASS (${checks} checks against ${BASE_URL}; data stays in the server's store, locally .data/store.json)`)
