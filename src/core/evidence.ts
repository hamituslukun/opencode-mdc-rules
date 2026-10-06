import { createHash } from "node:crypto"
import { mentions } from "./mentions.ts"
import type { RuleContext } from "./types.ts"

export const LOAD_TOOL = "mdc_rules_load"
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function toolFiles(tool: string, input: unknown): string[] {
  const args = record(input)
  const name = tool.split(".").at(-1) ?? tool
  if (["read", "write", "edit", "multiedit"].includes(name)) {
    return [args.filePath, args.path, args.file_path].filter((v): v is string => typeof v === "string")
  }
  if (["patch", "apply_patch"].includes(name)) {
    const patch = args.patchText ?? args.patch ?? args.input
    if (typeof patch === "string") return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(m => m[1].trim())
  }
  return []
}

export interface ContextMessage {
  id?: string
  role: string
  text: string
  files: string[]
  selected: string[]
  synthetic?: boolean
}

export function evidence(messages: ContextMessage[]): RuleContext {
  const userIndex = messages.findLastIndex(message => message.role === "user" && !message.synthetic)
  const user = messages[userIndex]
  return {
    turn: user ? user.id ?? createHash("sha256").update(`${userIndex}:${user.text}`).digest("hex") : "",
    text: user?.text ?? "",
    files: [...new Set(messages.flatMap(message => message.files).concat(mentions(user?.text ?? "")))],
    selected: messages.slice(Math.max(0, userIndex)).flatMap(message => message.selected),
  }
}

export function v1Messages(messages: readonly unknown[]): ContextMessage[] {
  return messages.map(value => {
    const message = record(value)
    const info = record(message.info)
    const parts = Array.isArray(message.parts) ? message.parts.map(record) : []
    return {
      id: typeof info.id === "string" ? info.id : undefined,
      role: String(info.role),
      synthetic: info.role === "user" && parts.length > 0 && parts.every(p => p.type !== "text" || p.synthetic === true),
      text: parts.filter(p => p.type === "text" && !p.synthetic && !p.ignored).map(p => String(p.text ?? "")).join("\n"),
      files: parts.flatMap(p => {
        if (p.type === "file" && typeof p.url === "string" && p.url.startsWith("file:")) return [p.url]
        if (p.type === "tool" && record(p.state).status === "completed") return toolFiles(String(p.tool), record(p.state).input)
        return []
      }),
      selected: parts.flatMap(p => {
        const state = record(p.state)
        return p.type === "tool" && p.tool === LOAD_TOOL && state.status === "completed" && Array.isArray(record(state.input).rules)
          ? record(state.input).rules as string[] : []
      }),
    }
  })
}

export function v2Messages(messages: readonly unknown[]): ContextMessage[] {
  const calls = new Map<string, { name: string; input: unknown }>()
  return messages.map(value => {
    const message = record(value)
    const parts = Array.isArray(message.content) ? message.content.map(record) : []
    const files: string[] = []
    const selected: string[] = []
    for (const part of parts) {
      if (part.type === "tool-call") calls.set(String(part.id), { name: String(part.name), input: part.input })
      if (part.type === "tool-result" && record(part.result).type !== "error") {
        const call = calls.get(String(part.id))
        if (!call) continue
        files.push(...toolFiles(call.name, call.input))
        if (call.name === LOAD_TOOL && Array.isArray(record(call.input).rules)) selected.push(...record(call.input).rules as string[])
      }
      if (typeof part.uri === "string" && part.uri.startsWith("file:")) files.push(part.uri)
    }
    return {
      id: typeof message.id === "string" ? message.id : undefined,
      role: String(message.role),
      text: parts.filter(p => p.type === "text").map(p => String(p.text ?? "")).join("\n"),
      files, selected,
    }
  })
}
