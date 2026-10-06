import { Catalog } from "./catalog.ts"
import { LOAD_TOOL } from "./evidence.ts"
import { mentions, resolveRule } from "./mentions.ts"
import { matchesFile } from "./parser.ts"
import { relativeFile } from "./paths.ts"
import { renderRules, type Applied } from "./render.ts"
import type { Options, RuleContext, Snapshot } from "./types.ts"

export const MARKER = "<opencode-mdc-rules>"
interface SessionState {
  context: RuleContext
  selected: Set<string>
  applied: Map<string, Applied>
  warnings: string[]
  revision: number
  updatedAt: number
}

export class RulesEngine {
  readonly catalog: Catalog
  private sessions = new Map<string, SessionState>()
  private listeners = new Set<(snapshot: Snapshot) => void | Promise<void>>()
  private revision = 0
  private closed = false

  constructor(readonly root: string, readonly options: Options) {
    this.catalog = new Catalog(root, options, async () => {
      if (this.closed) return
      await this.publish("")
      for (const id of this.sessions.keys()) await this.publish(id)
    })
  }

  start(watching = true) { return this.catalog.start(watching) }
  onChange(listener: (snapshot: Snapshot) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private session(id: string): SessionState {
    let state = this.sessions.get(id)
    if (!state) {
      state = { context: { turn: "", text: "", files: [], selected: [] }, selected: new Set(), applied: new Map(), warnings: [], revision: 0, updatedAt: Date.now() }
      this.sessions.set(id, state)
    }
    return state
  }

  snapshot(sessionID: string): Snapshot {
    const state = this.sessions.get(sessionID)
    return {
      root: this.root, sessionID, revision: state?.revision ?? this.revision, updatedAt: state?.updatedAt ?? Date.now(),
      rules: this.catalog.rules.map(rule => {
        const applied = state?.applied.get(rule.id)
        // An always rule is active by definition, even before this plugin has
        // observed the Session's first model request. Other modes require
        // evidence from the assembled Session context.
        const always = rule.mode === "always" && rule.error === undefined
        const active = !!applied || always
        const pending = !!applied
          ? applied.rule.hash !== rule.hash
          : always && state !== undefined
        return {
          id: rule.id, mode: rule.mode, description: rule.description,
          active,
          ...(applied ? { reason: applied.reason } : always ? { reason: "always" as const } : {}),
          ...(applied?.detail === undefined ? {} : { detail: applied.detail }),
          ...(rule.error === undefined ? {} : { error: rule.error }),
          pending,
        }
      }),
      warnings: [...(this.catalog.error ? [this.catalog.error] : []), ...(state?.warnings ?? [])],
    }
  }

  private async publish(sessionID: string) {
    this.revision++
    const state = this.sessions.get(sessionID)
    if (state) { state.revision = this.revision; state.updatedAt = Date.now() }
    const snapshot = this.snapshot(sessionID)
    // A disconnected sidebar must never break the model request.
    await Promise.allSettled([...this.listeners].map(listener => listener(snapshot)))
  }

  async context(sessionID: string, input: RuleContext): Promise<string> {
    const state = this.session(sessionID)
    // Compaction continuations may contain only synthetic user messages. Keep the
    // current task's selection until an actual new user turn is admitted.
    if (!input.turn && state.context.turn) input = {
      ...state.context,
      files: [...new Set([...state.context.files, ...input.files])],
      selected: [...new Set([...state.context.selected, ...input.selected])],
    }
    if (state.context.turn !== input.turn) state.selected.clear()
    state.context = input
    const agentSelected = new Set(state.selected)
    state.selected.clear()
    for (const name of input.selected) {
      const { rule } = resolveRule(name, this.catalog.rules)
      if (rule?.mode === "agent" && !rule.error) agentSelected.add(rule.id)
    }
    const manual = new Set<string>()
    const warnings: string[] = []
    for (const name of mentions(input.text)) {
      const { rule, error } = resolveRule(name, this.catalog.rules)
      if (rule) manual.add(rule.id)
      if (error) warnings.push(error)
    }
    const files = input.files.filter(file => !resolveRule(file, this.catalog.rules).rule)
      .map(file => relativeFile(this.root, file)).filter((v): v is string => !!v && !v.startsWith(".opencode/rules/"))
    const selected: Applied[] = []
    for (const rule of this.catalog.rules) {
      if (rule.error) continue
      if (rule.mode === "always") selected.push({ rule, reason: "always" })
      else if (manual.has(rule.id)) selected.push({ rule, reason: "manual" })
      else if (rule.mode === "glob") {
        const file = files.find(file => matchesFile(rule, file))
        if (file) selected.push({ rule, reason: "glob", detail: file })
      } else if (rule.mode === "agent" && agentSelected.has(rule.id)) selected.push({ rule, reason: "agent" })
    }
    const rendered = await renderRules(this.root, this.catalog.rules, selected, this.options)
    state.applied = new Map(rendered.applied.map(entry => [entry.rule.id, entry]))
    state.warnings = [...warnings, ...rendered.warnings]
    await this.publish(sessionID)
    const available = this.catalog.rules.filter(rule => rule.mode === "agent" && !rule.error && !state.applied.has(rule.id))
    const catalog = available.length ? [
      `Available project rules. Call ${LOAD_TOOL} with relevant rule IDs before working on that topic. Select only rules relevant to the task:`,
      ...available.map(rule => `- ${JSON.stringify(rule.id)}: ${rule.description}`),
    ].join("\n") : ""
    const diagnostics = state.warnings.length ? `Rule diagnostics:\n${state.warnings.join("\n")}` : ""
    const body = [rendered.text, catalog, diagnostics].filter(Boolean).join("\n\n")
    return body ? `${MARKER}\n${body}\n</opencode-mdc-rules>` : ""
  }

  async load(sessionID: string, names: string[]): Promise<string> {
    const state = this.session(sessionID)
    const ids: string[] = []
    for (const name of names) {
      const { rule, error } = resolveRule(name, this.catalog.rules)
      if (!rule || error) throw new Error(error ?? `Unknown rule: ${name}`)
      if (rule.error) throw new Error(`${rule.id}: ${rule.error}`)
      if (rule.mode !== "agent") throw new Error(`${rule.id} is ${rule.mode}; only description-selected rules can be loaded by the agent`)
      ids.push(rule.id)
    }
    for (const id of ids) state.selected.add(id)
    // Content is injected once by the next context hook, rather than duplicated in tool history.
    return `Selected rules: ${ids.join(", ")}. Their current contents will be attached to the next model request.`
  }

  forget(sessionID: string) { this.sessions.delete(sessionID) }

  async close() {
    this.closed = true
    await this.catalog.close()
    this.listeners.clear()
    this.sessions.clear()
  }
}
