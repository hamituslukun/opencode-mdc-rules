import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { afterEach } from "bun:test"
import { RulesEngine } from "../src/core/engine.ts"
import { options } from "../src/core/types.ts"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

export async function fixture(files: Record<string, string> = {}) {
  const base = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA!, "Temp", "opencode") : tmpdir()
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, "mdc-test-"))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const write = async (name: string, body: string) => {
    const target = path.join(root, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
  }
  for (const [name, body] of Object.entries(files)) await write(name, body)
  return { root, write }
}

export async function engineFixture(files: Record<string, string>, watch = false) {
  const result = await fixture(Object.fromEntries(Object.entries(files).map(([name, body]) => [`.opencode/rules/${name}`, body])))
  const engine = new RulesEngine(result.root, options({ debounceMs: 10 }))
  cleanups.push(() => engine.close())
  await engine.start(watch)
  return { ...result, engine }
}

export async function eventually(predicate: () => boolean | Promise<boolean>, timeout = 5000) {
  const end = Date.now() + timeout
  while (!await predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for condition")
    await Bun.sleep(25)
  }
}

export const context = (text = "", files: string[] = [], selected: string[] = [], turn = "user-1") => ({ text, files, selected, turn })
