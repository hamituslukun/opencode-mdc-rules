import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathKey } from "./core/paths.ts"
import type { Snapshot } from "./core/types.ts"
import { SnapshotSchema } from "./status.ts"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const base = () => process.env.OPENCODE_MDC_RULES_STATE_DIR ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), "opencode-mdc-rules")
const folder = (directory: string) => path.join(base(), digest(pathKey(directory)))
const filename = (sessionID: string) => `${sessionID ? digest(sessionID) : "catalog"}.json`

async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

/** Local V1 bridge. Each server instance owns its own directory and lease. */
export class LocalState {
  readonly directory: string
  private queue = Promise.resolve()
  private timer?: ReturnType<typeof setInterval>
  private closed = false
  private readonly startedAt = Date.now()

  constructor(location: string) {
    this.directory = path.join(folder(location), `${process.pid}-${randomUUID()}`)
  }

  async start() {
    await this.heartbeat()
    this.timer = setInterval(() => void this.heartbeat().catch(() => {}), 5000)
    this.timer.unref?.()
  }

  private heartbeat() {
    if (this.closed) return Promise.resolve()
    return this.enqueue(() => atomic(path.join(this.directory, "owner.json"), { pid: process.pid, startedAt: this.startedAt, updatedAt: Date.now() }))
  }

  private enqueue(action: () => Promise<void>) {
    const task = this.queue.then(action)
    this.queue = task.catch(() => {})
    return task
  }

  write(snapshot: Snapshot) {
    if (this.closed) return Promise.resolve()
    return this.enqueue(() => atomic(path.join(this.directory, filename(snapshot.sessionID)), snapshot))
  }

  remove(sessionID: string) {
    return this.enqueue(() => rm(path.join(this.directory, filename(sessionID)), { force: true }))
  }

  async close() {
    this.closed = true
    clearInterval(this.timer)
    await this.queue
    await rm(this.directory, { recursive: true, force: true })
  }
}

export async function readLocalState(location: string, sessionID: string): Promise<Snapshot | undefined> {
  const directory = folder(location)
  let entries: string[]
  try { entries = await readdir(directory) } catch { return }
  const candidates: { snapshot: Snapshot; exact: boolean; startedAt: number }[] = []
  await Promise.all(entries.map(async name => {
    const ownerDir = path.join(directory, name)
    try {
      const owner = JSON.parse(await readFile(path.join(ownerDir, "owner.json"), "utf8")) as { pid: number; updatedAt: number; startedAt: number }
      if (!Number.isInteger(owner.pid) || Date.now() - owner.updatedAt > 20000) return
      process.kill(owner.pid, 0)
      let exact = true
      let source: string
      try { source = await readFile(path.join(ownerDir, filename(sessionID)), "utf8") }
      catch { exact = false; source = await readFile(path.join(ownerDir, filename("")), "utf8") }
      const result = SnapshotSchema.safeParse(JSON.parse(source))
      if (!result.success || (exact && result.data.sessionID !== sessionID)) return
      candidates.push({ snapshot: { ...result.data, sessionID }, exact, startedAt: owner.startedAt })
    } catch { /* A writer may have unloaded or atomically replaced its state. */ }
  }))
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || b.startedAt - a.startedAt || b.snapshot.revision - a.snapshot.revision)
  return candidates[0]?.snapshot
}
