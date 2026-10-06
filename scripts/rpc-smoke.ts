import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const [binary, packageDirectory = fileURLToPath(new URL("..", import.meta.url))] = process.argv.slice(2)
assert(binary, "Usage: bun scripts/rpc-smoke.ts <opencode-v2 executable> [installed package directory]")
const temporary = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA!, "Temp", "opencode") : tmpdir()
await mkdir(temporary, { recursive: true })
const root = await mkdtemp(path.join(temporary, "mdc-rpc-smoke-"))
const project = path.join(root, "project")
const home = path.join(root, "home")
await mkdir(path.join(project, ".opencode", "rules"), { recursive: true })
await mkdir(home, { recursive: true })
await writeFile(path.join(project, ".opencode", "rules", "general.md"), "RPC_SENTINEL")
await writeFile(path.join(project, "opencode.json"), JSON.stringify({ plugins: [pathToFileURL(path.resolve(packageDirectory)).href] }))
const probe = Bun.serve({ port: 0, fetch: () => new Response() })
const port = probe.port
probe.stop(true)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_")))
const server = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: project,
  env: {
    ...env, HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"),
    XDG_CACHE_HOME: path.join(home, "cache"), XDG_STATE_HOME: path.join(home, "state"),
    OPENCODE_DB: path.join(home, "smoke.sqlite"), OPENCODE_CONFIG: path.join(project, "opencode.json"),
    OPENCODE_SERVER_PASSWORD: "test",
  },
  stdout: "pipe", stderr: "pipe",
})
const stdout = new Response(server.stdout).text()
const stderr = new Response(server.stderr).text()
try {
  const base = `http://127.0.0.1:${port}`
  const headers = { Authorization: `Basic ${btoa("opencode:test")}` }
  let ready = false
  for (let i = 0; i < 300; i++) {
    try { ready = (await fetch(`${base}/api/info`, { headers })).ok } catch {}
    if (ready) break
    await Bun.sleep(100)
  }
  if (!ready) {
    server.kill()
    await server.exited
    assert.fail(`OpenCode server did not become ready:\n${await stdout}\n${await stderr}`)
  }
  const location = `location%5Bdirectory%5D=${encodeURIComponent(project)}`
  const created = await fetch(`${base}/api/session?${location}`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}",
  })
  const createdText = await created.text()
  assert(created.ok, `Session creation failed (${created.status}): ${createdText}`)
  const sessionID = JSON.parse(createdText).data.id as string
  const response = await fetch(`${base}/api/rpc/opencode-mdc-rules/snapshot?${location}`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ input: { sessionID } }),
  })
  const text = await response.text()
  assert(response.ok, `RPC failed (${response.status}): ${text}`)
  const body = JSON.parse(text)
  assert.equal(body.output.sessionID, sessionID)
  assert.equal(body.output.rules[0].id, "general.md")
  assert.equal(body.output.rules[0].active, true)
  assert.equal(body.output.rules[0].reason, "always")
  console.log("v2 RPC JSON transport OK")
} finally {
  server.kill()
  await server.exited
  await rm(root, { recursive: true, force: true })
}
