import { expect, test } from "bun:test"
import { LocalState, readLocalState } from "../src/local-state.ts"
import type { Snapshot } from "../src/core/types.ts"
import { fixture } from "./helpers.ts"

test("V1 status bridge isolates locations/sessions, publishes atomically, and cleans up", async () => {
  const { root } = await fixture()
  const store = new LocalState(root)
  const snapshot: Snapshot = { root, sessionID: "s1", revision: 1, updatedAt: Date.now(), rules: [], warnings: [] }
  try {
    await store.start()
    await store.write({ ...snapshot, sessionID: "" })
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.write({ ...snapshot, revision: i + 2 })))
    expect((await readLocalState(root, "s1"))?.revision).toBe(21)
    expect((await readLocalState(root, "s2"))?.revision).toBe(1)
    expect(await readLocalState(`${root}/other`, "s1")).toBeUndefined()
    await store.remove("s1")
    expect((await readLocalState(root, "s1"))?.revision).toBe(1)
  } finally { await store.close() }
  expect(await readLocalState(root, "s1")).toBeUndefined()
})
