import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const [version, binary, packageDirectory = fileURLToPath(new URL("..", import.meta.url))] = process.argv.slice(2)
assert(version === "v1" || version === "v2", "Usage: bun scripts/install-smoke.ts v1|v2 <opencode executable> [package directory]")
assert(binary, "Missing OpenCode executable")

const source = path.resolve(packageDirectory)
const manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"))
const name = manifest.name as string
const packageVersion = manifest.version as string
assert(name && packageVersion, "Package manifest must contain name and version")
assert(manifest.exports?.["./server"], "Package must export ./server")
assert(manifest.exports?.["./tui"], "Package must export ./tui")

const temporary = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA!, "Temp", "opencode") : tmpdir()
await mkdir(temporary, { recursive: true })
const root = await mkdtemp(path.join(temporary, `mdc-install-smoke-${version}-`))
const project = path.join(root, "project")
const home = path.join(root, "home")
await mkdir(project, { recursive: true })
await mkdir(home, { recursive: true })

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const pack = Bun.spawn([npm, "pack", "--ignore-scripts", "--json", "--pack-destination", root, source], {
  cwd: root, stdout: "pipe", stderr: "pipe",
})
const [packStdout, packStderr, packCode] = await Promise.all([
  new Response(pack.stdout).text(), new Response(pack.stderr).text(), pack.exited,
])
assert.equal(packCode, 0, `npm pack failed (${packCode}):\n${packStdout}\n${packStderr}`)
const packed = JSON.parse(packStdout) as Array<{ filename: string }>
const tarball = await readFile(path.join(root, packed[0]!.filename))
const shasum = createHash("sha1").update(tarball).digest("hex")
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`

let registryBase = ""
const registry = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const metadataPath = `/${encodeURIComponent(name)}`
    if (url.pathname === `/${name}` || url.pathname === metadataPath) {
      return Response.json({
        _id: name,
        name,
        "dist-tags": { latest: packageVersion },
        versions: {
          [packageVersion]: {
            ...manifest,
            dist: {
              tarball: `${registryBase}${name}/-/${name}-${packageVersion}.tgz`,
              shasum,
              integrity,
            },
          },
        },
      })
    }
    if (url.pathname === `/${name}/-/${name}-${packageVersion}.tgz`) {
      return new Response(tarball, { headers: { "Content-Type": "application/octet-stream" } })
    }
    const upstream = new URL(url.pathname + url.search, "https://registry.npmjs.org")
    const headers = new Headers(request.headers)
    headers.delete("host")
    headers.delete("authorization")
    const response = await fetch(upstream, { method: request.method, headers })
    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete("content-encoding")
    responseHeaders.delete("content-length")
    return new Response(response.body, { status: response.status, headers: responseHeaders })
  },
})
registryBase = `http://127.0.0.1:${registry.port}/`

const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_")))
const env = {
  ...baseEnv,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(home, "config"),
  XDG_DATA_HOME: path.join(home, "data"),
  XDG_CACHE_HOME: path.join(home, "cache"),
  XDG_STATE_HOME: path.join(home, "state"),
  OPENCODE_DB: path.join(home, "install-smoke.sqlite"),
  NPM_CONFIG_REGISTRY: registryBase,
  npm_config_registry: registryBase,
  BUN_CONFIG_REGISTRY: registryBase,
}

async function config(paths: string[]) {
  for (const file of paths) {
    try { return { file, value: JSON.parse(await readFile(file, "utf8")) } } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  assert.fail(`Expected configuration file at one of:\n${paths.join("\n")}`)
}

try {
  const args = version === "v1" ? [binary, "plugin", name] : [binary, "plugin", "add", name]
  const install = Bun.spawn(args, { cwd: project, env, stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => install.kill(), 120_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(install.stdout).text(), new Response(install.stderr).text(), install.exited,
  ])
  clearTimeout(timeout)
  assert.equal(code, 0, `OpenCode plugin install failed (${code}):\n${stdout}\n${stderr}`)

  if (version === "v1") {
    const directory = path.join(project, ".opencode")
    const server = await config([path.join(directory, "opencode.json"), path.join(directory, "opencode.jsonc")])
    const tui = await config([path.join(directory, "tui.json"), path.join(directory, "tui.jsonc")])
    assert(server.value.plugin?.includes(name), `Server plugin missing from ${server.file}`)
    assert(tui.value.plugin?.includes(name), `TUI plugin missing from ${tui.file}`)
    console.log(`v1: ${name} automatically configured for server and TUI`)
  } else {
    const directory = path.join(home, "config", "opencode")
    const server = await config([path.join(directory, "opencode.json"), path.join(directory, "opencode.jsonc")])
    assert(server.value.plugins?.includes(name), `Plugin missing from ${server.file}`)
    assert.equal(server.value.plugin, undefined, "V2 installer wrote the legacy plugin field")
    console.log(`v2: ${name} automatically configured; ./tui is available for automatic loading`)
  }

  await rm(root, { recursive: true, force: true })
} catch (error) {
  console.error(`Install smoke artifacts retained at ${root}`)
  throw error
} finally {
  registry.stop(true)
}
