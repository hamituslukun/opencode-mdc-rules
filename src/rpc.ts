import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"
import { SnapshotSchema } from "./status.ts"

export const RulesRpc = Rpc.define({
  id: "opencode-mdc-rules",
  methods: {
    snapshot: {
      input: z.object({ sessionID: z.string() }),
      output: SnapshotSchema,
    },
    reload: { input: z.object({ sessionID: z.string() }), output: SnapshotSchema },
  },
  events: { updated: { schema: SnapshotSchema } },
})
