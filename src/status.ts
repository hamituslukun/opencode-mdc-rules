import { z } from "zod"

export const SnapshotSchema = z.object({
  root: z.string(),
  sessionID: z.string(),
  revision: z.number(),
  updatedAt: z.number(),
  rules: z.array(z.object({
    id: z.string(), mode: z.enum(["always", "glob", "agent", "manual"]), description: z.string(),
    active: z.boolean(), reason: z.enum(["always", "glob", "agent", "manual", "reference"]).optional(),
    detail: z.string().optional(), error: z.string().optional(), pending: z.boolean(),
  })),
  warnings: z.array(z.string()),
})
