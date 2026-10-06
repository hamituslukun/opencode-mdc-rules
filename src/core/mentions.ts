import path from "node:path"
import { slash } from "./paths.ts"
import type { Rule } from "./types.ts"

export function mentions(text: string): string[] {
  // Pasted fenced examples and email addresses are not manual invocations.
  const prose = text.replace(/```[^]*?```|~~~[^]*?~~~/g, "")
  return [...prose.matchAll(/(?:^|[\s([{>])@(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s<>"'`\[\](){},;!?]+))/g)]
    .map(match => slash(match[1] ?? match[2] ?? match[3]).replace(/[.:]+$/, ""))
}

export function resolveRule(name: string, rules: readonly Rule[]): { rule?: Rule; error?: string } {
  const key = slash(name).replace(/^\.\//, "").replace(/^\.opencode\/rules\//, "")
  const exact = rules.find(rule => rule.id === key)
  if (exact) return { rule: exact }
  const candidates = rules.filter(rule =>
    rule.id.replace(/\.(mdc|md)$/, "") === key ||
    path.posix.basename(rule.id).replace(/\.(mdc|md)$/, "") === key ||
    path.posix.basename(rule.id) === key)
  if (candidates.length === 1) return { rule: candidates[0] }
  if (candidates.length > 1) return { error: `Ambiguous rule @${name}: ${candidates.map(r => r.id).join(", ")}` }
  return {}
}
