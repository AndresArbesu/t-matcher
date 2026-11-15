// Run against a disposable `supabase start` and local Next server only.
// No credentials or OTPs are printed; this creates two synthetic users and test rows.
import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const appUrl = process.env.SMOKE_APP_URL ?? 'http://127.0.0.1:3000'
const mailpitUrl = process.env.SMOKE_MAILPIT_URL ?? 'http://127.0.0.1:54324'
if (!supabaseUrl?.startsWith('http://127.0.0.1:54321') || !appUrl.startsWith('http://127.0.0.1:')) {
  throw new Error('Refusing to run against nonlocal services')
}

function client() {
  const jar = new Map()
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  return { jar, supabase }
}

async function emailLink(address) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await fetch(`${mailpitUrl}/api/v1/messages`).then((r) => r.json())
    const found = list.messages?.find((m) => m.To?.some((to) => to.Address === address))
    if (found) {
      const message = await fetch(`${mailpitUrl}/api/v1/message/${found.ID}`).then((r) => r.json())
      const raw = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
      assert.ok(raw, 'Mailpit message lacks link')
      const url = new URL(raw)
      assert.equal(url.origin, supabaseUrl)
      const hash = url.searchParams.get('token')
      assert.ok(hash, 'Mailpit link lacks token hash')
      return hash
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Synthetic sign-in mail not received')
}

async function signIn(address) {
  const c = client()
  const sent = await c.supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: `${appUrl}/auth/callback` } })
  assert.equal(sent.error, null, 'OTP request failed')
  const verified = await c.supabase.auth.verifyOtp({ token_hash: await emailLink(address), type: 'magiclink' })
  assert.equal(verified.error, null, 'OTP verification failed')
  assert.ok(verified.data.user, 'No authenticated user')
  assert.ok(c.jar.size, 'No auth cookies issued')
  return c
}

async function request(path, identity, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' }
  if (identity) headers.Cookie = [...identity.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const response = await fetch(`${appUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

const unauthenticated = await request('/api/players')
assert.equal(unauthenticated.status, 401, JSON.stringify(unauthenticated.body))
const stamp = Date.now()
const owner = await signIn(`tm-smoke-a-${stamp}@example.invalid`)
const other = await signIn(`tm-smoke-b-${stamp}@example.invalid`)
const names = ['Ana', 'Beto', 'Carla', 'Dani']
const players = []
for (const name of names) {
  const created = await request('/api/players', owner, 'POST', { name, skill_level: 3 })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  players.push(created.body)
}
assert.equal((await request('/api/players', owner)).body.length, 4)
assert.deepEqual((await request('/api/players', other)).body, [])
const date = '2026-11-15'
const ids = players.map((p) => p.id)
const draft = { participants: ids, matches: [{ team1: ids.slice(0, 2), team2: ids.slice(2, 4), locked: true }] }
const saved = await request(`/api/sessions/${date}`, owner, 'PUT', draft)
assert.equal(saved.status, 200, JSON.stringify(saved.body))
assert.equal(saved.body.session.matches.length, 1)
assert.equal(saved.body.session.matches[0].locked, true)
const matchId = saved.body.session.matches[0].id
assert.deepEqual((await request(`/api/sessions/${date}`, other)).body, { session: null })
const forbidden = await request(`/api/sessions/${date}`, other, 'PUT', draft)
assert.equal(forbidden.status, 422, JSON.stringify(forbidden.body))
const record = await request(`/api/matches/${matchId}`, owner, 'PATCH', { played: true, notes: 'synthetic smoke' })
assert.equal(record.status, 200, JSON.stringify(record.body))
assert.equal((await request('/api/history', owner)).body.length, 1)
assert.deepEqual((await request('/api/history', other)).body, [])
const reloaded = await request(`/api/sessions/${date}`, owner)
assert.equal(reloaded.body.session.matches[0].played, true)
console.log('PASS: unauthenticated denied; two real local Auth users isolated; roster create/read; dated draft save/reload with lock; cross-account write denied; played match feeds history.')
