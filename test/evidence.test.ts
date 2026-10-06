import { expect, test } from "bun:test"
import { evidence, LOAD_TOOL, toolFiles, v1Messages, v2Messages } from "../src/core/evidence.ts"

test("V1 reads only successful structured file operations, not shell/path-looking text", () => {
  const result = evidence(v1Messages([
    { info: { id: "u", role: "user" }, parts: [{ type: "text", text: "Work on @src/a.ts" }] },
    { info: { id: "a", role: "assistant" }, parts: [
      { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/project/src/b.ts" } } },
      { type: "tool", tool: "read", state: { status: "error", input: { filePath: "failed.ts" } } },
      { type: "tool", tool: "bash", state: { status: "completed", input: { command: "cat uncertain.ts" } } },
      { type: "tool", tool: LOAD_TOOL, state: { status: "completed", input: { rules: ["backend.mdc"] } } },
    ] },
  ]))
  expect(result.files).toEqual(["/project/src/b.ts", "src/a.ts"])
  expect(result.selected).toEqual(["backend.mdc"])
  expect(result.turn).toBe("u")
})

test("V2 joins call IDs to successful results and scopes selection to the last user turn", () => {
  const messages = [
    { id: "u1", role: "user", content: [{ type: "text", text: "Old task" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "load1", name: LOAD_TOOL, input: { rules: ["old.mdc"] } }] },
    { role: "tool", content: [{ type: "tool-result", id: "load1", name: LOAD_TOOL, result: { type: "text", value: "ok" } }] },
    { id: "u2", role: "user", content: [{ type: "text", text: "New task" }] },
    { role: "assistant", content: [
      { type: "tool-call", id: "r", name: "read", input: { path: "src/x.ts" } },
      { type: "tool-call", id: "failed", name: "read", input: { path: "not-there.ts" } },
      { type: "tool-call", id: "load2", name: LOAD_TOOL, input: { rules: ["new.mdc"] } },
    ] },
    { role: "tool", content: [
      { type: "tool-result", id: "r", name: "read", result: { type: "text", value: "hello" } },
      { type: "tool-result", id: "failed", name: "read", result: { type: "error", value: "missing" } },
      { type: "tool-result", id: "load2", name: LOAD_TOOL, result: { type: "text", value: "ok" } },
    ] },
  ]
  const result = evidence(v2Messages(messages))
  expect(result.turn).toBe("u2")
  expect(result.selected).toEqual(["new.mdc"])
  expect(result.files).toEqual(["src/x.ts"])
})

test("patches include added, edited and renamed paths", () => {
  expect(toolFiles("patch", { patchText: "*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n*** Move to: c.ts\n*** End Patch" })).toEqual(["a.ts", "b.ts", "c.ts"])
})
