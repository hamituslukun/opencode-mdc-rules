import { expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode/plugin"
import { server } from "../src/adapters/v1/server.ts"
import { setup } from "../src/adapters/v2/server.ts"
import { readLocalState } from "../src/local-state.ts"
import { fixture } from "./helpers.ts"

test("V1 mutates the host's system array in place and publishes the same activity", async () => {
  const { root } = await fixture({ ".opencode/rules/general.md": "V1_RULE", ".opencode/rules/manual.mdc": "MANUAL_RULE" })
  const hooks = await server({ directory: root, worktree: root } as PluginInput)
  try {
    const messages = [{ info: { role: "user", id: "u", sessionID: "s" }, parts: [{ type: "text", text: "@manual" }] }]
    await hooks["experimental.chat.messages.transform"]!({}, { messages } as never)
    const system = ["Original host instructions"]
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s", model: {} } as never, { system })
    expect(system[0]).toBe("Original host instructions")
    expect(system.join("\n")).toContain("V1_RULE")
    expect(system.join("\n")).toContain("MANUAL_RULE")
    expect((await readLocalState(root, "s"))?.rules.every(rule => rule.active)).toBe(true)
    // Re-entering on the same owned array must not duplicate our contribution.
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s", model: {} } as never, { system })
    expect(system.join("\n").match(/V1_RULE/g)).toHaveLength(1)
  } finally { await hooks.dispose?.() }
  expect(await readLocalState(root, "s")).toBeUndefined()
})

test("V2 scopes RPC and model hooks to the session location; canonical URI attachments activate globs", async () => {
  const { root } = await fixture({ ".opencode/rules/react.mdc": '---\nglobs: "src/**/*.tsx"\n---\nV2_REACT' })
  let contextHook: (event: any) => Promise<void>
  let rpc: any
  const updates: any[] = []
  const ctx = {
    location: { directory: root, project: { directory: root } }, options: {},
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ location: { directory: sessionID === "other" ? `${root}/elsewhere` : root } }),
      context: async () => [{ id: "u", type: "user", text: "Fix the attached component", files: [{ source: { type: "uri", uri: `${root}/src/App.tsx` } }] }],
      hook: async (_name: string, callback: typeof contextHook) => { contextHook = callback },
    },
    rpc: { register: async (_definition: unknown, handlers: unknown) => {
      rpc = handlers
      return { events: { emit: async (_name: string, value: unknown) => { updates.push(value) } } }
    } },
    tool: { transform: async (callback: (editor: any) => void) => { callback({ add() {} }) } },
    event: { subscribe: async function* ({ signal }: { signal: AbortSignal }) {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
    } },
  } as unknown as Plugin.Context
  const cleanup = await setup(ctx)
  try {
    const event = { sessionID: "s", system: [], messages: [{ id: "u", role: "user", content: [{ type: "text", text: "Rendered attachment with misleading @manual" }] }] }
    await contextHook!(event)
    expect(JSON.stringify(event.system)).toContain("V2_REACT")
    expect((await rpc.snapshot({ sessionID: "s" })).rules[0].active).toBe(true)
    expect(updates.at(-1).rules[0].reason).toBe("glob")
    const other = { ...event, sessionID: "other", system: [] }
    await contextHook!(other)
    expect(other.system).toEqual([])
    await expect(rpc.snapshot({ sessionID: "other" })).rejects.toThrow("another location")
  } finally { await cleanup?.() }
})
