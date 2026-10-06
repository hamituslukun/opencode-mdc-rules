/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Snapshot } from "../../core/types.ts"
import { readLocalState } from "../../local-state.ts"
import { ruleDetails, Sidebar } from "../../ui/sidebar.tsx"

function Rules(props: { api: TuiPluginApi; sessionID: string }) {
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [error, setError] = createSignal<string>()
  createEffect(() => {
    const id = props.sessionID
    const location = props.api.state.session.get(id)?.directory ?? props.api.state.path.directory
    let closed = false
    let busy = false
    setSnapshot(undefined)
    const refresh = async () => {
      if (closed || busy || !location) return
      busy = true
      try {
        const value = await readLocalState(location, id)
        if (closed) return
        setSnapshot(value)
        setError(value ? undefined : "Rules server unavailable")
      } catch (error) {
        if (!closed) { setSnapshot(undefined); setError(String(error)) }
      } finally { busy = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 500)
    onCleanup(() => { closed = true; clearInterval(timer) })
  })
  return <Sidebar snapshot={snapshot()} error={error()} text={props.api.theme.current.text} muted={props.api.theme.current.textMuted}
    inspect={rule => {
      const DialogAlert = props.api.ui.DialogAlert
      props.api.ui.dialog.replace(() => <DialogAlert title="Project rule" message={ruleDetails(rule)} />)
    }} />
}

export const tui: TuiPlugin = async api => {
  api.slots.register({
    order: 550,
    slots: { sidebar_content: (_context, input) => <Rules api={api} sessionID={input.session_id} /> },
  })
}
