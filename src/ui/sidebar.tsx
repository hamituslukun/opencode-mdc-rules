/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { RuleStatus, Snapshot } from "../core/types.ts"

export function ruleName(id: string): string {
  return id.replaceAll("\\", "/").split("/").at(-1) ?? id
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0
}

export function sortRules(rules: readonly RuleStatus[]): RuleStatus[] {
  return [...rules].sort((left, right) =>
    Number(right.active) - Number(left.active) ||
    compareText(ruleName(left.id), ruleName(right.id)) ||
    compareText(left.id, right.id))
}

export function ruleDetails(rule: RuleStatus): string {
  return [
    rule.id,
    `Mode: ${rule.mode}`,
    `Status: ${rule.active ? "active" : "inactive"}`,
    rule.reason && `Reason: ${rule.reason}${rule.detail ? ` (${rule.detail})` : ""}`,
    rule.description,
    rule.pending && "Changed on disk; the next model request will use the new version.",
    rule.error && `Error: ${rule.error}`,
  ].filter(Boolean).join("\n\n")
}

export function Sidebar(props: {
  snapshot?: Snapshot
  error?: string
  text: string | RGBA
  muted: string | RGBA
  inspect: (rule: RuleStatus) => void
}) {
  const rules = () => sortRules(props.snapshot?.rules ?? [])
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <text fg={props.text}><b>Rules</b><span style={{ fg: props.muted }}> · {rules().filter(rule => rule.active).length}/{rules().length} active</span></text>
      <Show when={props.error}><text fg={props.muted}>{props.error}</text></Show>
      <Show when={!props.snapshot && !props.error}><text fg={props.muted}>Connecting to rules server…</text></Show>
      <Show when={props.snapshot && !rules().length}><text fg={props.muted}>No .md / .mdc rules found</text></Show>
      <Show when={rules().length > 0}>
        <scrollbox height={Math.min(rules().length, 12)} scrollX={false}
          horizontalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column", gap: 0 }}>
          <For each={rules()}>{rule => (
            <box flexDirection="row" height={1} flexShrink={0} onMouseUp={() => props.inspect(rule)}>
              <text fg={props.text} wrapMode="none">
                <span style={{ fg: rule.active ? "#22c55e" : "#ef4444" }}>●</span>
                {` ${ruleName(rule.id)}${rule.error ? " !" : rule.pending ? " *" : ""}`}
              </text>
            </box>
          )}</For>
        </scrollbox>
      </Show>
      <Show when={props.snapshot?.warnings.length}>
        <For each={props.snapshot?.warnings}>{warning => <text fg={props.muted}>{warning}</text>}</For>
      </Show>
    </box>
  )
}
