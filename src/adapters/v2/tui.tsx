/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { pathKey } from "../../core/paths.ts"
import type { Snapshot } from "../../core/types.ts"
import { RulesRpc } from "../../rpc.ts"
import { ruleDetails, Sidebar } from "../../ui/sidebar.tsx"

function Rules(props: { ctx: Plugin.Context; sessionID: string }) {
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [error, setError] = createSignal<string>()
  createEffect(() => {
    const id = props.sessionID
    const location = props.ctx.data.session.get(id)?.location ?? props.ctx.location ?? props.ctx.data.location.default()
    const rpc = props.ctx.client.rpc(RulesRpc)
    const controller = new AbortController()
    let busy = false
    let changes = 0
    setSnapshot(undefined)
    const refresh = async () => {
      if (busy || controller.signal.aborted) return
      busy = true
      const before = changes
      try {
        const value = await rpc.snapshot({ sessionID: id }, { location, signal: controller.signal })
        if (!controller.signal.aborted && before === changes) { setSnapshot(value); setError(undefined) }
      } catch (error) {
        if (!controller.signal.aborted && before === changes) { setSnapshot(undefined); setError(`Rules server unavailable: ${String(error)}`) }
      } finally { busy = false }
    }
    const unsubscribe = rpc.events.on("updated", event => {
      if (pathKey(event.location.directory) !== pathKey(location.directory)) return
      if (event.data.sessionID === id) {
        changes++
        setSnapshot(event.data)
        setError(undefined)
      } else if (!event.data.sessionID) void refresh()
    }, { signal: controller.signal })
    void refresh()
    // RPC events are live-only: snapshots recover missed events and server reloads.
    const timer = setInterval(() => void refresh(), 3000)
    onCleanup(() => { controller.abort(); unsubscribe(); clearInterval(timer) })
  })
  return <Sidebar snapshot={snapshot()} error={error()} text={props.ctx.theme.text.base} muted={props.ctx.theme.text.weak}
    inspect={rule => { void props.ctx.ui.dialog.alert({ title: "Project rule", message: ruleDetails(rule) }) }} />
}

export const setup: Plugin.Definition["setup"] = ctx => ctx.ui.slot({
  append: "sidebar.content",
  render: input => <Rules ctx={ctx} sessionID={input.sessionID} />,
})
