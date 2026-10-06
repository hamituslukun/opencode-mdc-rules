export type RuleMode = "always" | "glob" | "agent" | "manual"
export type ActivationReason = RuleMode | "reference"

export interface Rule {
  id: string
  path: string
  hash: string
  body: string
  description: string
  globs: string[]
  mode: RuleMode
  error?: string
}

export interface RuleStatus {
  id: string
  mode: RuleMode
  description: string
  active: boolean
  reason?: ActivationReason
  detail?: string
  error?: string
  pending: boolean
}

export interface Snapshot {
  root: string
  sessionID: string
  revision: number
  updatedAt: number
  rules: RuleStatus[]
  warnings: string[]
}

/** Only evidence present in the outgoing context belongs here. */
export interface RuleContext {
  turn: string
  text: string
  files: string[]
  selected: string[]
}

export interface Options {
  root?: string
  debounceMs: number
  maxFileBytes: number
  maxReferenceDepth: number
}

export function options(input: Record<string, unknown> = {}): Options {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = input[key]
    if (value === undefined) return fallback
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}`)
    return Number(value)
  }
  if (input.root !== undefined && typeof input.root !== "string") throw new Error("root must be a path string")
  return {
    root: input.root as string | undefined,
    debounceMs: integer("debounceMs", 100, 0, 5000),
    maxFileBytes: integer("maxFileBytes", 262144, 1024, 10485760),
    maxReferenceDepth: integer("maxReferenceDepth", 8, 1, 32),
  }
}
