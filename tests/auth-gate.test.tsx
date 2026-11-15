// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthGate, type AuthClient, type AuthLabels } from "@/components/auth-gate"

afterEach(cleanup)

const labels: AuthLabels = {
  loading: "Checking session…",
  title: "Sign in",
  email: "Email",
  sendCode: "Email me a code",
  checkEmail: "Check your email for a sign-in link or code.",
  code: "Code",
  verify: "Verify code",
  sendFailed: "Could not send the email. Try again.",
  verifyFailed: "That code did not work. Try again.",
  sessionFailed: "Could not check your session.",
  signedInAs: "Signed in as",
  signOut: "Sign out",
}

function fakeAuth(overrides: Partial<AuthClient> = {}, session: { user: { email: string } } | null = null) {
  let listener: ((e: string, s: unknown) => void) | undefined
  const auth: AuthClient = {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: vi.fn().mockImplementation((cb) => {
      listener = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockImplementation(async () => {
      listener?.("SIGNED_OUT", null)
      return { error: null }
    }),
    ...overrides,
  }
  return { auth, emit: (e: string, s: unknown) => listener?.(e, s) }
}

const renderGate = (auth: AuthClient) =>
  render(
    <AuthGate auth={auth} labels={labels} isDarkMode={false} redirectTo="http://localhost:3000/auth/callback">
      <p>private schedule</p>
    </AuthGate>,
  )

describe("AuthGate", () => {
  it("shows a loading state and hides content until the session is known", async () => {
    let resolve!: (v: unknown) => void
    const { auth } = fakeAuth({ getSession: vi.fn().mockReturnValue(new Promise((r) => (resolve = r))) as never })
    renderGate(auth)
    expect(screen.getByText(labels.loading)).toBeTruthy()
    expect(screen.queryByText("private schedule")).toBeNull()
    resolve({ data: { session: null }, error: null })
    await screen.findByLabelText(labels.email)
  })

  it("does not render private content when signed out", async () => {
    renderGate(fakeAuth().auth)
    await screen.findByLabelText(labels.email)
    expect(screen.queryByText("private schedule")).toBeNull()
  })

  it("requests an email code/magic link and then offers code entry", async () => {
    const { auth } = fakeAuth()
    renderGate(auth)
    fireEvent.change(await screen.findByLabelText(labels.email), { target: { value: "me@example.com" } })
    fireEvent.click(screen.getByText(labels.sendCode))
    await screen.findByText(labels.checkEmail)
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "me@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback" },
    })
    expect(screen.getByLabelText(labels.code)).toBeTruthy()
  })

  it("shows a fixed message, not the provider message, when sending fails", async () => {
    const { auth } = fakeAuth({ signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "rate limit: smtp key abc" } }) })
    renderGate(auth)
    fireEvent.change(await screen.findByLabelText(labels.email), { target: { value: "me@example.com" } })
    fireEvent.click(screen.getByText(labels.sendCode))
    await screen.findByText(labels.sendFailed)
    expect(screen.queryByText(/smtp/)).toBeNull()
    expect(screen.queryByText(labels.checkEmail)).toBeNull()
  })

  it("verifies the emailed code and reports a fixed error when it fails", async () => {
    const { auth } = fakeAuth({ verifyOtp: vi.fn().mockResolvedValue({ error: { message: "Token has expired" } }) })
    renderGate(auth)
    fireEvent.change(await screen.findByLabelText(labels.email), { target: { value: "me@example.com" } })
    fireEvent.click(screen.getByText(labels.sendCode))
    fireEvent.change(await screen.findByLabelText(labels.code), { target: { value: "123456" } })
    fireEvent.click(screen.getByText(labels.verify))
    await screen.findByText(labels.verifyFailed)
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.com", token: "123456", type: "email" })
    expect(screen.queryByText(/expired/)).toBeNull()
  })

  it("renders content for a signed-in user, shows who they are, and signs out", async () => {
    const { auth } = fakeAuth({}, { user: { email: "me@example.com" } })
    renderGate(auth)
    await screen.findByText("private schedule")
    expect(screen.getByText(/me@example.com/)).toBeTruthy()
    fireEvent.click(screen.getByText(labels.signOut))
    await screen.findByLabelText(labels.email)
    expect(auth.signOut).toHaveBeenCalled()
    expect(screen.queryByText("private schedule")).toBeNull()
  })

  it("moves from signed-out to signed-in when the auth state changes (magic link)", async () => {
    const { auth, emit } = fakeAuth()
    renderGate(auth)
    await screen.findByLabelText(labels.email)
    emit("SIGNED_IN", { user: { email: "me@example.com" } })
    await screen.findByText("private schedule")
  })

  it("shows an error state, not an endless spinner, when the session check fails", async () => {
    const { auth } = fakeAuth({ getSession: vi.fn().mockRejectedValue(new Error("network down")) as never })
    renderGate(auth)
    await waitFor(() => expect(screen.getByText(labels.sessionFailed)).toBeTruthy())
    expect(screen.queryByText(labels.loading)).toBeNull()
  })
})
