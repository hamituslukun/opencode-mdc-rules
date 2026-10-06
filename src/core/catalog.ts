import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { watch, type FSWatcher } from "chokidar"
import { parseRule } from "./parser.ts"
import { slash } from "./paths.ts"
import type { Options, Rule } from "./types.ts"

export class Catalog {
  rules: Rule[] = []
  error?: string
  readonly directory: string
  private watcher?: FSWatcher
  private timer?: ReturnType<typeof setTimeout>
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(readonly root: string, private readonly options: Options, private readonly changed: () => Promise<void>) {
    this.directory = path.join(root, ".opencode", "rules")
  }

  async start(watching = true) {
    if (watching) {
      // Watch the existing project root too, so creating .opencode/rules after
      // startup is observed on Windows as well as POSIX.
      this.watcher = watch(this.root, {
        ignoreInitial: true, followSymlinks: false,
        ignored: file => {
          const relative = slash(path.relative(this.root, file))
          return relative !== "" && relative !== ".opencode" && relative !== ".opencode/rules" && !relative.startsWith(".opencode/rules/")
        },
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
      })
      this.watcher.on("all", () => {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.reload(), this.options.debounceMs)
      })
      this.watcher.on("error", error => {
        this.error = `Rule watcher: ${String(error)}`
        void this.changed().catch(() => {})
      })
      await new Promise<void>((resolve, reject) => {
        this.watcher!.once("ready", resolve)
        this.watcher!.once("error", reject)
      })
    }
    await this.reload()
  }

  reload(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.closed) return
      const next: Rule[] = []
      try {
        const visit = async (directory: string) => {
          let entries
          try { entries = await readdir(directory, { withFileTypes: true }) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return
            throw error
          }
          for (const entry of entries) {
            const file = path.join(directory, entry.name)
            if (entry.isDirectory()) { await visit(file); continue }
            if (!entry.isFile() || !/\.(md|mdc)$/.test(entry.name)) continue
            const id = slash(path.relative(this.directory, file))
            try {
              if ((await stat(file)).size > this.options.maxFileBytes) throw new Error(`Rule exceeds ${this.options.maxFileBytes} bytes`)
              next.push(parseRule(id, file, await readFile(file, "utf8")))
            } catch (error) {
              next.push({ ...parseRule(id, file, ""), error: String(error) })
            }
          }
        }
        await visit(this.directory)
        this.error = undefined
      } catch (error) {
        this.error = `Rule discovery: ${String(error)}`
      }
      next.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const changed = JSON.stringify(next) !== JSON.stringify(this.rules)
      this.rules = next
      if (changed || this.error) await this.changed()
    }).catch(error => { this.error = String(error) })
    return this.queue
  }

  async close() {
    this.closed = true
    clearTimeout(this.timer)
    await this.watcher?.close()
    await this.queue
  }
}
