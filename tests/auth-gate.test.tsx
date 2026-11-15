// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthGate, type AuthLabels } from "@/components/auth-gate"
import { translations } from "@/lib/translations"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const labels: AuthLabels = {
  loading: "Checking session…",
  title: "Sign in",
  passcode: "Passcode",
  enter: "Enter",
  wrongPasscode: "That passcode is not right.",
  networkFailed: "Could not reach the server.",
  loginFailed: "Could not sign in. Try again.",
  sessionFailed: "Could not check your session.",
  signOut: "Sign out",
  downloadBackup: "Download backup",
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/** Fetch fake of the three auth endpoints; `signedIn` flips on login and off on logout. */
function fakeAuthApi(opts: { signedIn?: boolean; login?: () => Response | Promise<Response>; session?: () => Response | Promise<Response> } = {}) {
  let signedIn = opts.signedIn ?? false
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (url === "/api/session" && method === "GET") {
      if (opts.session) return opts.session()
      return signedIn ? json(200, { ok: true }) : json(401, { error: "unauthorized" })
    }
    if (url === "/api/login" && method === "POST") {
      const res = opts.login ? await opts.login() : json(200, { ok: true })
      if (res.ok) signedIn = true
      return res
    }
    if (url === "/api/logout" && method === "POST") {
      signedIn = false
      return json(200, { ok: true })
    }
    return json(404, { error: "not_found" })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const renderGate = () =>
  render(
    <AuthGate labels={labels} isDarkMode={false}>
      <p>private schedule</p>
    </AuthGate>,
  )

const enter = async (passcode: string) => {
  fireEvent.change(await screen.findByLabelText(labels.passcode), { target: { value: passcode } })
  fireEvent.click(screen.getByRole("button", { name: labels.enter }))
}

describe("AuthGate", () => {
  it("shows a loading state and hides content until the session is known", async () => {
    let resolve!: (r: Response) => void
    fakeAuthApi({ session: () => new Promise<Response>((r) => (resolve = r)) })
    renderGate()
    expect(screen.getByText(labels.loading)).toBeTruthy()
    expect(screen.queryByText("private schedule")).toBeNull()
    resolve(json(401, { error: "unauthorized" }))
    await screen.findByLabelText(labels.passcode)
  })

  it("asks for a single password field, not an email or a code, when signed out", async () => {
    fakeAuthApi()
    renderGate()
    const input = (await screen.findByLabelText(labels.passcode)) as HTMLInputElement
    expect(input.type).toBe("password")
    expect(input.autocomplete).toBe("current-password")
    expect(screen.queryByText("private schedule")).toBeNull()
    expect(document.querySelectorAll("input")).toHaveLength(1)
    expect(document.querySelector('input[type="email"]')).toBeNull()
  })

  it("posts the passcode and shows the app on success", async () => {
    const fetchMock = fakeAuthApi()
    renderGate()
    await enter("s3cret")
    await screen.findByText("private schedule")
    const [, init] = fetchMock.mock.calls.find(([u]) => u === "/api/login")!
    expect(JSON.parse(init!.body as string)).toEqual({ passcode: "s3cret" })
    expect(init!.method).toBe("POST")
  })

  it("submits with the Enter key (form submit)", async () => {
    fakeAuthApi()
    renderGate()
    fireEvent.change(await screen.findByLabelText(labels.passcode), { target: { value: "s3cret" } })
    fireEvent.submit(screen.getByLabelText(labels.passcode).closest("form")!)
    await screen.findByText("private schedule")
  })

  it("keeps the button disabled while the field is empty or a request is running", async () => {
    let finish!: (r: Response) => void
    fakeAuthApi({ login: () => new Promise<Response>((r) => (finish = r)) })
    renderGate()
    const button = (await screen.findByRole("button", { name: labels.enter })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await enter("s3cret")
    await waitFor(() => expect((screen.getByRole("button", { name: labels.enter }) as HTMLButtonElement).disabled).toBe(true))
    finish(json(200, { ok: true }))
    await screen.findByText("private schedule")
  })

  it("shows the fixed wrong-passcode message on 401 and stays signed out", async () => {
    fakeAuthApi({ login: () => json(401, { error: "unauthorized", detail: "leaky provider text" }) })
    renderGate()
    await enter("nope")
    expect((await screen.findByRole("alert")).textContent).toBe(labels.wrongPasscode)
    expect(screen.queryByText("private schedule")).toBeNull()
    expect(screen.queryByText(/leaky/)).toBeNull()
    expect((screen.getByLabelText(labels.passcode) as HTMLInputElement).value).toBe("nope")
  })

  it("shows the fixed network message when the server cannot be reached", async () => {
    const fetchMock = fakeAuthApi()
    renderGate()
    await screen.findByLabelText(labels.passcode)
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await enter("x")
    expect((await screen.findByRole("alert")).textContent).toBe(labels.networkFailed)
  })

  it("shows a generic message for other server failures, never provider text", async () => {
    fakeAuthApi({ login: () => json(500, { error: "server_error" }) })
    renderGate()
    await enter("x")
    expect((await screen.findByRole("alert")).textContent).toBe(labels.loginFailed)
  })

  it("renders content for a signed-in user with Sign out and a backup link", async () => {
    fakeAuthApi({ signedIn: true })
    renderGate()
    await screen.findByText("private schedule")
    const link = screen.getByRole("link", { name: labels.downloadBackup }) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe("/api/export")
    expect(link.hasAttribute("download")).toBe(true)
  })

  it("does not show the backup link while signed out", async () => {
    fakeAuthApi()
    renderGate()
    await screen.findByLabelText(labels.passcode)
    expect(screen.queryByRole("link", { name: labels.downloadBackup })).toBeNull()
  })

  it("signs out through /api/logout and returns to the passcode form", async () => {
    const fetchMock = fakeAuthApi({ signedIn: true })
    renderGate()
    await screen.findByText("private schedule")
    fireEvent.click(screen.getByText(labels.signOut))
    await screen.findByLabelText(labels.passcode)
    expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/logout" && i?.method === "POST")).toBe(true)
    expect(screen.queryByText("private schedule")).toBeNull()
    expect((screen.getByLabelText(labels.passcode) as HTMLInputElement).value).toBe("")
  })

  it("shows an error state, not an endless spinner, when the session check fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")))
    renderGate()
    await waitFor(() => expect(screen.getByText(labels.sessionFailed)).toBeTruthy())
    expect(screen.queryByText(labels.loading)).toBeNull()
  })

  it("treats a 500 from the session check as an error, not as signed out", async () => {
    fakeAuthApi({ session: () => json(500, { error: "server_error" }) })
    renderGate()
    await screen.findByText(labels.sessionFailed)
  })
})

describe("auth translations", () => {
  it.each(["en", "es"] as const)("%s has exactly the passcode strings and no email/code leftovers", (lang) => {
    expect(Object.keys(translations[lang].auth).sort()).toEqual(Object.keys(labels).sort())
    for (const value of Object.values(translations[lang].auth)) expect(value.length).toBeGreaterThan(0)
    const text = JSON.stringify(translations[lang])
    expect(text).not.toMatch(/Supabase|NEXT_PUBLIC|magic|correo|e-?mail|sendCode|verify/i)
  })
  it("es and en differ", () => {
    expect(translations.es.auth.enter).toBe("Entrar")
    expect(translations.en.auth.enter).toBe("Enter")
  })
})
