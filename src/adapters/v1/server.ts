import type { Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { RulesEngine, MARKER } from "../../core/engine.ts"
import { evidence, LOAD_TOOL, v1Messages } from "../../core/evidence.ts"
import { projectRoot } from "../../core/paths.ts"
import { options, type RuleContext } from "../../core/types.ts"
import { LocalState } from "../../local-state.ts"

export const server: Plugin = async (ctx, input) => {
  const config = options(input)
  const engine = new RulesEngine(projectRoot(ctx.directory, ctx.worktree, config.root), config)
  const store = new LocalState(ctx.directory)
  const contexts = new Map<string, RuleContext>()
  const stop = engine.onChange(snapshot => store.write(snapshot))
  try {
    await store.start()
    await engine.start()
    await store.write(engine.snapshot(""))
  } catch (error) {
    stop()
    await engine.close()
    await store.close()
    throw error
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const id = output.messages.find(message => message.info.sessionID)?.info.sessionID
      if (id) contexts.set(id, evidence(v1Messages(output.messages)))
    },
    "experimental.chat.system.transform": async ({ sessionID }, output) => {
      // Title/auxiliary calls without a captured agent context do not change sidebar activity.
      if (!sessionID) return
      const context = contexts.get(sessionID)
      if (!context) return
      const text = await engine.context(sessionID, context)
      for (let i = output.system.length - 1; i >= 0; i--) {
        if (output.system[i].startsWith(MARKER)) output.system.splice(i, 1)
      }
      if (text) output.system.push(text)
    },
    tool: {
      [LOAD_TOOL]: {
        description: "Select relevant description-based project rules from the available rules catalog. Their contents are attached before the next model request.",
        args: { rules: z.array(z.string()).min(1).describe("Rule IDs from the available project rules catalog") },
        execute: async ({ rules }, context) => engine.load(context.sessionID, z.array(z.string()).min(1).parse(rules)),
      },
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const id = event.properties.info.id
        engine.forget(id)
        contexts.delete(id)
        await store.remove(id)
      }
    },
    dispose: async () => {
      stop()
      await engine.close()
      await store.close()
      contexts.clear()
    },
  }
}
