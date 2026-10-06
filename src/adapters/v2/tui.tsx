/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { pathKey } from "../../core/paths.ts"
import type { Snapshot } from "../../core/types.ts"
import { RulesRpc } from "../../rpc.ts"
import { ruleDetails, Sidebar } from "../../ui/sidebar.tsx"

const REQUEST_TIMEOUT_MS = 10_000

export async function withAbortTimeout<T>(
  parent: AbortSignal,
  milliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let rejectDeadline!: (reason: Error) => void
  const deadline = new Promise<T>((_resolve, reject) => { rejectDeadline = reject })
  const cancel = (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error("Rules server request aborted")
    controller.abort(error)
    rejectDeadline(error)
  }
  const abort = () => cancel(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    const error = new Error(`Rules server timed out after ${milliseconds}ms`)
    cancel(error)
  }, milliseconds)
  try {
    return await Promise.race([operation(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
    parent.removeEventListener("abort", abort)
  }
}

function Rules(props: { ctx: Plugin.Context; sessionID: string }) {
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [error, setError] = createSignal<string>()
  createEffect(() => {
    const id = props.sessionID
    const rpc = props.ctx.client.rpc(RulesRpc)
    const controller = new AbortController()
    let location: ReturnType<typeof props.ctx.data.location.default> | undefined
    let busy = false
    let changes = 0
    setSnapshot(undefined)
    const refresh = async () => {
      if (busy || controller.signal.aborted) return
      busy = true
      const before = changes
      try {
        const value = await withAbortTimeout(controller.signal, REQUEST_TIMEOUT_MS, async signal => {
          let session = props.ctx.data.session.get(id)
          if (!session) {
            await props.ctx.data.session.sync(id)
            if (signal.aborted) throw signal.reason
            session = props.ctx.data.session.get(id)
          }
          location = session?.location ?? props.ctx.location
          if (!location) throw new Error(`Session location unavailable: ${id}`)
          return rpc.snapshot({ sessionID: id }, { location, signal })
        })
        if (!controller.signal.aborted && before === changes) { setSnapshot(value); setError(undefined) }
      } catch (error) {
        if (!controller.signal.aborted && before === changes) { setSnapshot(undefined); setError(`Rules server unavailable: ${String(error)}`) }
      } finally { busy = false }
    }
    const unsubscribe = rpc.events.on("updated", event => {
      if (location && pathKey(event.location.directory) !== pathKey(location.directory)) return
      if (event.data.sessionID === id) {
        location ??= event.location
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
