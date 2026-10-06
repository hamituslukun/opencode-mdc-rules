import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

// No external model or account is used: the OpenCode process talks to a local
// deterministic OpenAI-compatible endpoint. Pass an installed package directory
// as the third argument to exercise an npm tarball rather than the source tree.
const [version, binary, packageDirectory = fileURLToPath(new URL("..", import.meta.url))] = process.argv.slice(2)
assert(version === "v1" || version === "v2", "Usage: bun scripts/smoke.ts v1|v2 <opencode executable> [installed package directory]")
assert(binary, "Missing OpenCode executable")
const temporary = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA!, "Temp", "opencode") : tmpdir()
await mkdir(temporary, { recursive: true })
const root = await mkdtemp(path.join(temporary, `mdc-smoke-${version}-`))
const project = path.join(root, "project")
const write = async (name: string, value: string) => {
  const file = path.join(project, name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, value)
}
const requests: Record<string, any>[] = []
let chosen = false
const mock = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    if (request.method !== "POST") return Response.json({ data: [] })
    const body = await request.json() as Record<string, any>
    requests.push(body)
    const system = JSON.stringify(body.messages?.filter((m: any) => m.role === "system" || m.role === "developer"))
    const primary = system.includes("<opencode-mdc-rules>")
    const tool = body.tools?.find((t: any) => t.function?.name === "mdc_rules_load")
    const call = primary && tool && !chosen
    if (call) chosen = true
    const message = call
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_mdc_1", type: "function", function: { name: "mdc_rules_load", arguments: JSON.stringify({ rules: ["backend.mdc"] }) } }] }
      : { role: "assistant", content: "MDC_SMOKE_OK" }
    const finish_reason = call ? "tool_calls" : "stop"
    const base = { id: "chatcmpl-mdc", created: Math.floor(Date.now() / 1000), model: "test" }
    if (!body.stream) return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, ...message.tool_calls![0] }] }
      : message
    return new Response([
      { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] },
      { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })
  },
})

try {
  await write(".opencode/rules/general.md", "MDC_ALWAYS_SENTINEL")
  await write(".opencode/rules/frontend/react.mdc", '---\nglobs: "src/**/*.tsx"\n---\nMDC_GLOB_SENTINEL')
  await write(".opencode/rules/review.mdc", "---\nalwaysApply: false\n---\nMDC_MANUAL_SENTINEL")
  await write(".opencode/rules/backend.mdc", "---\ndescription: Backend service conventions\n---\nMDC_AGENT_SENTINEL")
  await write(".opencode/rules/inactive.mdc", "---\nglobs: '*.sql'\n---\nMDC_INACTIVE_SENTINEL")
  await write("src/App.tsx", "export const App = () => null")
  const model = { name: "Test", limit: { context: 128000, output: 4096 } }
  const config = version === "v2" ? {
    plugins: [pathToFileURL(path.resolve(packageDirectory)).href],
    model: "smoke/test",
    providers: { smoke: {
      name: "Smoke", env: ["SMOKE_API_KEY"], package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `${mock.url}v1`, apiKey: "test" },
      models: { test: { ...model, capabilities: { tools: true } } },
    } },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  } : {
    plugin: [pathToFileURL(path.resolve(packageDirectory)).href],
    model: "smoke/test",
    provider: { smoke: {
      name: "Smoke", npm: "@ai-sdk/openai-compatible",
      options: { baseURL: `${mock.url}v1`, apiKey: "test" },
      models: { test: { ...model, tool_call: true } },
    } },
    permission: { "*": "allow" },
  }
  await write("opencode.json", JSON.stringify(config))
  if (process.env.MDC_SMOKE_DEBUG) await write(".opencode/plugins/diagnostic.ts", `
    export const Diagnostic = async () => {
      try { const m = await import(${JSON.stringify(pathToFileURL(path.join(packageDirectory, "src/index.ts")).href)}); console.error("MDC_ENTRY", Object.keys(m.default)); }
      catch (e) { console.error("MDC_IMPORT_ERROR", e); }
      return {
        config: async (c) => console.error("MDC_CONFIG_PLUGINS", JSON.stringify(c.plugin_origins)),
        "experimental.chat.messages.transform": async (i,o) => console.error("MDC_MESSAGES", JSON.stringify(o.messages)),
        "experimental.chat.system.transform": async (i,o) => console.error("MDC_SYSTEM", JSON.stringify(i)),
      };
    }
  `)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_") && !key.endsWith("_API_KEY")))
  const home = path.join(root, "home")
  await mkdir(home, { recursive: true })
  const process_ = Bun.spawn([binary, "run", ...(version === "v2" ? ["--standalone"] : []), "--print-logs", "--log-level", version === "v1" ? "DEBUG" : "debug", "--format", "json", "--file", "src/App.tsx", ...(version === "v1" ? ["--"] : []), "Use @review for this backend task in @src/App.tsx."], {
    cwd: project,
    env: {
      ...env,
      HOME: home, USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"), XDG_STATE_HOME: path.join(home, "state"),
      OPENCODE_DB: path.join(home, "smoke.sqlite"), OPENCODE_CONFIG: path.join(project, "opencode.json"),
      OPENCODE_MDC_RULES_STATE_DIR: path.join(home, "rules-state"), SMOKE_API_KEY: "test",
    },
    stdout: "pipe", stderr: "pipe",
  })
  const timeout = setTimeout(() => process_.kill(), 90000)
  const [stdout, stderr, code] = await Promise.all([new Response(process_.stdout).text(), new Response(process_.stderr).text(), process_.exited])
  clearTimeout(timeout)
  await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2))
  await writeFile(path.join(root, "output.log"), stdout + "\n" + stderr)
  assert.equal(code, 0, `OpenCode failed (${code}):\n${stdout}\n${stderr}`)
  const systems = requests.map(body => JSON.stringify(body.messages?.filter((m: any) => m.role === "system" || m.role === "developer")))
    .filter(text => text.includes("<opencode-mdc-rules>"))
  assert(systems.length >= 2, `Expected model continuation after rule selection; got ${systems.length}. Output:\n${stdout}\n${stderr}`)
  for (const system of systems) {
    assert(system.includes("MDC_ALWAYS_SENTINEL"), "Always rule missing")
    assert(system.includes("MDC_GLOB_SENTINEL"), "Attached file did not activate glob rule")
    assert(system.includes("MDC_MANUAL_SENTINEL"), "Manual rule missing")
    assert(!system.includes("MDC_INACTIVE_SENTINEL"), "Inactive rule leaked into model context")
  }
  assert(!systems[0].includes("MDC_AGENT_SENTINEL"), "Agent rule activated before selection")
  assert(systems.at(-1)!.includes("MDC_AGENT_SENTINEL"), "Agent-selected rule missing from continuation")
  assert(stdout.includes("MDC_SMOKE_OK"), "Model output not delivered")
  console.log(`${version}: installed plugin + model context + attachments + manual selection + agent tool continuation OK`)
  await rm(root, { recursive: true, force: true })
} catch (error) {
  console.error(`Smoke artifacts retained at ${root}`)
  throw error
} finally {
  mock.stop(true)
}
