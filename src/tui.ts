import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { Plugin } from "@opencode/plugin/tui"

// Import only the adapter selected by the host: V1 and V2 have different OpenTUI APIs.
export default {
  id: "opencode-mdc-rules.tui",
  setup: (async ctx => (await import("./adapters/v2/tui.tsx")).setup(ctx)) satisfies Plugin.Definition["setup"],
  tui: (async (api, options, meta) => (await import("./adapters/v1/tui.tsx")).tui(api, options, meta)) satisfies TuiPlugin,
}
