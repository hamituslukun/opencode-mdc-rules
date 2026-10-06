import { createHash } from "node:crypto"
import { parseDocument } from "yaml"
import picomatch from "picomatch"
import type { Rule } from "./types.ts"

// Commas inside braces/extglobs/character classes are not pattern separators.
export function splitGlobs(value: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === "\\") { i++; continue }
    if ("{[(".includes(ch)) depth++
    if ("}])".includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === "," && depth === 0) {
      result.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  result.push(value.slice(start).trim())
  return result.filter(Boolean)
}

export function parseRule(id: string, path: string, source: string): Rule {
  const rule: Rule = {
    id, path, hash: createHash("sha256").update(source).digest("hex"),
    body: source.replace(/^\uFEFF/, ""), description: "", globs: [], mode: "manual",
  }
  try {
    const lines = rule.body.split(/\r?\n/)
    if (lines[0]?.trim() !== "---") {
      rule.mode = id.endsWith(".md") ? "always" : "manual"
      return rule
    }
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line))
    if (end < 0) throw new Error("Unclosed YAML frontmatter")
    const document = parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true })
    if (document.errors.length) throw new Error(document.errors.map(e => e.message).join("; "))
    const data: unknown = document.toJS({ maxAliasCount: 50 }) ?? {}
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("Frontmatter must be a YAML mapping")
    const meta = data as Record<string, unknown>
    if (meta.alwaysApply != null && typeof meta.alwaysApply !== "boolean") throw new Error("alwaysApply must be true or false")
    if (meta.description != null && typeof meta.description !== "string") throw new Error("description must be a string")
    rule.description = (meta.description as string | undefined)?.trim() ?? ""
    const globs = meta.globs ?? ""
    if (typeof globs !== "string" && !(Array.isArray(globs) && globs.every(v => typeof v === "string")))
      throw new Error("globs must be a comma-separated string or string array")
    rule.globs = (Array.isArray(globs) ? globs : [globs]).flatMap(splitGlobs)
    for (const glob of rule.globs) picomatch(glob, { strictBrackets: true })
    rule.body = lines.slice(end + 1).join("\n").trim()
    rule.mode = meta.alwaysApply === true ? "always" : rule.globs.length ? "glob" : rule.description ? "agent" : "manual"
  } catch (error) {
    rule.error = error instanceof Error ? error.message : String(error)
  }
  return rule
}

export function matchesFile(rule: Rule, file: string): boolean {
  const positives = rule.globs.filter(g => !g.startsWith("!"))
  const negatives = rule.globs.filter(g => g.startsWith("!")).map(g => g.slice(1))
  const options = { dot: true, nocase: process.platform === "win32" }
  return (positives.length === 0 || picomatch(positives, options)(file)) &&
    !(negatives.length && picomatch(negatives, options)(file))
}
