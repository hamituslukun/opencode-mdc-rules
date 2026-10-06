import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { mentions, resolveRule } from "./mentions.ts"
import { relativeFile } from "./paths.ts"
import type { ActivationReason, Options, Rule } from "./types.ts"

export interface Applied { rule: Rule; reason: ActivationReason; detail?: string }

export async function renderRules(root: string, rules: readonly Rule[], initial: Applied[], options: Options) {
  const applied = new Map<string, Applied>()
  const files = new Set<string>()
  const warnings: string[] = []
  const chunks: string[] = []
  const canonicalRoot = await realpath(root)

  const reference = async (name: string, from: Rule, depth: number) => {
    if (depth > options.maxReferenceDepth) { warnings.push(`Reference depth exceeded in ${from.id}: @${name}`); return }
    const resolved = resolveRule(name, rules)
    if (resolved.error) { warnings.push(resolved.error); return }
    if (resolved.rule) { await add({ rule: resolved.rule, reason: "reference", detail: from.id }, depth); return }
    // Resolve beside the rule first, then from the project root.
    for (const candidate of [path.resolve(path.dirname(from.path), name), path.resolve(root, name)]) {
      if (!relativeFile(root, candidate)) continue
      try {
        const canonical = await realpath(candidate)
        if (!relativeFile(canonicalRoot, canonical)) continue
        if (files.has(canonical)) return
        const info = await stat(canonical)
        if (!info.isFile()) continue
        if (info.size > options.maxFileBytes) { warnings.push(`Reference exceeds ${options.maxFileBytes} bytes: @${name}`); return }
        const source = await readFile(canonical, "utf8")
        if (source.includes("\0")) { warnings.push(`Binary reference skipped: @${name}`); return }
        files.add(canonical)
        chunks.push(`### Referenced file: ${relativeFile(root, candidate)}\n\n${source}`)
        // Ordinary source files are literal content; only rules recursively resolve @ references.
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { warnings.push(`Cannot read @${name}: ${String(error)}`); return }
      }
    }
    warnings.push(`Reference not found inside project: @${name} (from ${from.id})`)
  }

  const add = async (entry: Applied, depth: number) => {
    if (applied.has(entry.rule.id)) return
    if (entry.rule.error) { warnings.push(`${entry.rule.id}: ${entry.rule.error}`); return }
    applied.set(entry.rule.id, entry)
    chunks.push(`### Rule: ${entry.rule.id}\n\n${entry.rule.body}`)
    for (const name of mentions(entry.rule.body)) await reference(name, entry.rule, depth + 1)
  }
  // Preserve the direct reason even when a preceding rule references this rule.
  for (const entry of initial) await add(entry, 0)
  for (const entry of initial) if (applied.has(entry.rule.id)) applied.set(entry.rule.id, entry)
  return { text: chunks.join("\n\n"), applied: [...applied.values()], warnings }
}
