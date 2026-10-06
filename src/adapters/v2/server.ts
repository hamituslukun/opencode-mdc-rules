import type { Plugin } from "@opencode/plugin"
import { RulesEngine, MARKER } from "../../core/engine.ts"
import { evidence, LOAD_TOOL, v2Messages } from "../../core/evidence.ts"
import { pathKey, projectRoot } from "../../core/paths.ts"
import { options } from "../../core/types.ts"
import { RulesRpc } from "../../rpc.ts"

export const setup: Plugin.Plugin["setup"] = async ctx => {
  const config = options(ctx.options)
  const engine = new RulesEngine(projectRoot(ctx.location.directory, ctx.location.project.directory, config.root), config)
  const controller = new AbortController()
  type SessionID = Parameters<typeof ctx.session.get>[0]["sessionID"]
  const belongs = async (sessionID: string) => {
    const session = await ctx.session.get({ sessionID: sessionID as SessionID })
    return pathKey(session.location.directory) === pathKey(ctx.location.directory)
  }
  try {
    await engine.start()
    const rpc = await ctx.rpc.register(RulesRpc, {
      snapshot: async ({ sessionID }) => {
        if (sessionID && !await belongs(sessionID)) throw new Error("Session belongs to another location")
        return engine.snapshot(sessionID)
      },
      reload: async ({ sessionID }) => {
        if (sessionID && !await belongs(sessionID)) throw new Error("Session belongs to another location")
        await engine.catalog.reload()
        return engine.snapshot(sessionID)
      },
    })
    engine.onChange(snapshot => rpc.events.emit("updated", snapshot))

    await ctx.session.hook("context", async event => {
      if (!await belongs(event.sessionID)) return
      const projected = v2Messages(event.messages)
      // Use canonical user text/attachment URIs, not the rendered contents of attached files.
      const canonical = await ctx.session.context({ sessionID: event.sessionID })
      const users = canonical.filter(message => message.type === "user")
      for (const message of projected) {
        const user = users.find(user => user.id === message.id)
        if (user) {
          message.text = user.text
          message.files.push(...(user.files ?? []).flatMap(file => file.source.type === "uri" ? [file.source.uri] : []))
        }
        else if (message.role === "user") message.synthetic = true
      }
      const context = evidence(projected)
      const text = await engine.context(event.sessionID, context)
      event.system = event.system.filter(part => !(part.type === "text" && part.text.startsWith(MARKER)))
      if (text) event.system.push({ type: "text", text })
    })

    await ctx.tool.transform(editor => editor.add({
      name: LOAD_TOOL,
      options: { codemode: false },
      description: "Select relevant description-based project rules from the available rules catalog. Their contents are attached before the next model request.",
      input: { type: "object", properties: { rules: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["rules"], additionalProperties: false },
      execute: async (input, context) => {
        if (!await belongs(context.sessionID)) throw new Error("Session belongs to another location")
        const { rules } = input as { rules: string[] }
        return { content: await engine.load(context.sessionID, rules) }
      },
    }))

    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "session.deleted" || event.type === "session.moved") engine.forget(event.data.sessionID)
      }
    })().catch(error => { if (!controller.signal.aborted) console.error("opencode-mdc-rules event stream", error) })
    return async () => { controller.abort(); await events; await engine.close() }
  } catch (error) {
    controller.abort()
    await engine.close()
    throw error
  }
}
