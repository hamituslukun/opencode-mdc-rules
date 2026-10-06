/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { createSignal } from "solid-js"
import { ruleName, Sidebar, sortRules } from "../src/ui/sidebar.tsx"
import { setup, withAbortTimeout } from "../src/adapters/v2/tui.tsx"
import type { Snapshot } from "../src/core/types.ts"

const snapshot = (sessionID: string, active = false): Snapshot => ({
  root: "C:/project", sessionID, revision: 1, updatedAt: Date.now(), warnings: [],
  rules: [
    { id: "general.md", mode: "always", description: "", active: true, reason: "always", pending: false },
    { id: "frontend/react.mdc", mode: "glob", description: "", active, pending: false },
  ],
})

test("sidebar renders actual green/red dots and reacts to activity", async () => {
  const [value, update] = createSignal(snapshot("s"))
  const view = await testRender(() => <Sidebar snapshot={value()} text="#ffffff" muted="#888888" inspect={() => {}} />, { width: 50, height: 12 })
  try {
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("1/2 active")
    expect(view.captureCharFrame()).toContain("● general.md")
    expect(view.captureCharFrame()).toContain("● react.mdc")
    expect(view.captureCharFrame()).not.toContain("frontend/react.mdc")
    expect(view.captureCharFrame()).not.toContain("●general.md")
    const dots = view.captureSpans().lines.flatMap(line => line.spans).filter(span => span.text.includes("●"))
    expect(dots).toHaveLength(2)
    expect(dots[0].fg).toEqual(RGBA.fromHex("#22c55e"))
    expect(dots[1].fg).toEqual(RGBA.fromHex("#ef4444"))
    update(snapshot("s", true))
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("2/2 active")
  } finally { view.renderer.destroy() }
})

test("V2 sidebar RPC subscription ignores other sessions and unregisters on unmount", async () => {
  let render: any
  let receive: any
  let stopped = false
  const ctx = {
    location: { directory: "C:/project" },
    data: { session: { get: () => ({ location: { directory: "C:/project" } }), sync: async () => {} } },
    client: { rpc: () => ({
      snapshot: async () => snapshot("s"),
      events: { on: (_name: string, callback: unknown) => { receive = callback; return () => { stopped = true } } },
    }) },
    theme: { text: { base: "#ffffff", weak: "#888888" } },
    ui: { slot: (claim: any) => { render = claim.render; return () => {} }, dialog: { alert: async () => {} } },
  }
  await setup(ctx as never)
  const view = await testRender(() => render({ sessionID: "s" }), { width: 50, height: 12 })
  try {
    await view.waitForFrame(frame => frame.includes("1/2 active"))
    receive({ location: { directory: "C:/project" }, data: snapshot("other", true) })
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("1/2 active")
    receive({ location: { directory: "C:/elsewhere" }, data: snapshot("s", true) })
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("1/2 active")
    receive({ location: { directory: "C:/project" }, data: snapshot("s", true) })
    await view.renderOnce()
    expect(view.captureCharFrame()).toContain("2/2 active")
  } finally { view.renderer.destroy() }
  expect(stopped).toBe(true)
})

test("V2 sidebar syncs an uncached session before choosing its RPC location", async () => {
  let render: any
  let session: any
  let requestedLocation: string | undefined
  const ctx = {
    location: undefined,
    data: {
      location: { default: () => ({ directory: "C:/wrong-default" }) },
      session: {
        get: () => session,
        sync: async () => { session = { location: { directory: "C:/project" } } },
      },
    },
    client: { rpc: () => ({
      snapshot: async (_input: unknown, options: any) => {
        requestedLocation = options.location.directory
        return snapshot("s")
      },
      events: { on: () => () => {} },
    }) },
    theme: { text: { base: "#ffffff", weak: "#888888" } },
    ui: { slot: (claim: any) => { render = claim.render; return () => {} }, dialog: { alert: async () => {} } },
  }
  await setup(ctx as never)
  const view = await testRender(() => render({ sessionID: "s" }), { width: 50, height: 12 })
  try {
    await view.waitForFrame(frame => frame.includes("1/2 active"))
    expect(requestedLocation).toBe("C:/project")
  } finally { view.renderer.destroy() }
})

test("V2 RPC waits have a deadline", async () => {
  const controller = new AbortController()
  let signal: AbortSignal | undefined
  await expect(withAbortTimeout(controller.signal, 5, async value => {
    signal = value
    return new Promise<never>(() => {})
  })).rejects.toThrow("timed out after 5ms")
  expect(signal?.aborted).toBe(true)
})

test("rule names use only the basename on both path styles", () => {
  expect(ruleName("framework/common/abp-core.mdc")).toBe("abp-core.mdc")
  expect(ruleName("framework\\common\\application-layer.mdc")).toBe("application-layer.mdc")
})

test("active rules sort first, then by filename and full ID", () => {
  const rules = [
    { id: "z/inactive.mdc", mode: "manual", description: "", active: false, pending: false },
    { id: "z/shared.mdc", mode: "always", description: "", active: true, pending: false },
    { id: "a/shared.mdc", mode: "always", description: "", active: true, pending: false },
    { id: "x/alpha.mdc", mode: "always", description: "", active: true, pending: false },
    { id: "a/beta.mdc", mode: "manual", description: "", active: false, pending: false },
  ] as const
  expect(sortRules(rules).map(rule => rule.id)).toEqual([
    "x/alpha.mdc",
    "a/shared.mdc",
    "z/shared.mdc",
    "a/beta.mdc",
    "z/inactive.mdc",
  ])
})
