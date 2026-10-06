import { Plugin } from "@opencode/plugin"
import type { Plugin as V1Plugin } from "@opencode-ai/plugin"

export default {
  ...Plugin.define({
    id: "opencode-mdc-rules",
    setup: async ctx => (await import("./adapters/v2/server.ts")).setup(ctx),
  }),
  server: (async (ctx, options) => (await import("./adapters/v1/server.ts")).server(ctx, options)) satisfies V1Plugin,
}
