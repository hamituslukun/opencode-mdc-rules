import { describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { matchesFile, parseRule, splitGlobs } from "../src/core/parser.ts"
import { projectRoot, relativeFile } from "../src/core/paths.ts"
import { mentions, resolveRule } from "../src/core/mentions.ts"
import { context, engineFixture, eventually } from "./helpers.ts"

describe("Cursor frontmatter", () => {
  test.each([
    ["a.mdc", "---\nalwaysApply: true\nglobs: '**/*.tsx'\ndescription: UI\n---\nbody", "always"],
    ["a.mdc", "---\nalwaysApply: false\nglobs: src/**\ndescription: UI\n---\nbody", "glob"],
    ["a.mdc", "---\ndescription: UI\n---\nbody", "agent"],
    ["a.mdc", "---\nalwaysApply: false\n---\nbody", "manual"],
    ["a.mdc", "plain", "manual"],
    ["a.md", "plain", "always"],
    ["a.md", "---\nalwaysApply: false\n---\nbody", "manual"],
    ["a.md", "---\nglobs:\ndescription:\n---\nbody", "manual"],
  ])("%s classifies as %s", (id, body, mode) => {
    const rule = parseRule(id, id, body)
    expect(rule.error).toBeUndefined()
    expect(String(rule.mode)).toBe(mode)
  })

  test("BOM, CRLF, multiline descriptions, arrays and brace globs", () => {
    const rule = parseRule("a.mdc", "a", '\uFEFF---\r\ndescription: >\r\n  UI patterns\r\n  and conventions\r\nglobs: ["src/**/*.{ts,tsx}", "docs/**/*.md, docs/**/*.mdx"]\r\n---\r\nbody')
    expect(rule.description).toBe("UI patterns and conventions")
    expect(rule.globs).toEqual(["src/**/*.{ts,tsx}", "docs/**/*.md", "docs/**/*.mdx"])
    expect(rule.body).toBe("body")
  })

  test.each([
    "---\nalwaysApply: 'false'\n---\nx",
    "---\nglobs: 12\n---\nx",
    "---\nalwaysApply: true\nalwaysApply: false\n---\nx",
    "---\nglobs: '['\n---\nx",
    "---\ndescription: unfinished",
  ])("invalid metadata is diagnosed", source => expect(parseRule("a.mdc", "a", source).error).toBeDefined())

  test("glob root semantics and negation", () => {
    const rule = parseRule("a.mdc", "a", '---\nglobs: "*.ts, src/**/*.{ts,tsx}, !src/generated/**"\n---\nx')
    expect(matchesFile(rule, "index.ts")).toBe(true)
    expect(matchesFile(rule, "nested/index.ts")).toBe(false)
    expect(matchesFile(rule, "src/ui/App.tsx")).toBe(true)
    expect(matchesFile(rule, "src/generated/schema.ts")).toBe(false)
    expect(splitGlobs("src/*.{ts,tsx}, docs/**")).toEqual(["src/*.{ts,tsx}", "docs/**"])
  })
})

describe("activation and injected context", () => {
  const files = {
    "general.md": "GENERAL_SENTINEL",
    "frontend/react.mdc": '---\nglobs: "src/**/*.tsx"\n---\nREACT_SENTINEL',
    "backend.mdc": "---\ndescription: Backend service conventions\n---\nBACKEND_SENTINEL",
    "review.mdc": "---\nalwaysApply: false\n---\nREVIEW_SENTINEL",
  }

  test("always rules are active before the first request; contextual status agrees with the injected body", async () => {
    const { root, engine } = await engineFixture(files)
    expect(engine.snapshot("s1").rules.filter(rule => rule.active).map(rule => rule.id)).toEqual(["general.md"])
    expect(engine.snapshot("s1").rules.find(rule => rule.id === "general.md")?.reason).toBe("always")
    const text = await engine.context("s1", context("Use @review", [pathToFileURL(path.join(root, "src/App.tsx")).href]))
    expect(text).toContain("GENERAL_SENTINEL")
    expect(text).toContain("REACT_SENTINEL")
    expect(text).toContain("REVIEW_SENTINEL")
    expect(text).not.toContain("BACKEND_SENTINEL")
    expect(text).toContain("Backend service conventions")
    expect(engine.snapshot("s1").rules.filter(r => r.active).map(r => r.id)).toEqual(["frontend/react.mdc", "general.md", "review.mdc"])
    expect(engine.snapshot("s2").rules.filter(rule => rule.active).map(rule => rule.id)).toEqual(["general.md"])
  })

  test("snapshots contain only JSON transport values", async () => {
    const { engine } = await engineFixture(files)
    const inactive = engine.snapshot("s")
    const assertJson = (value: unknown, path = "output") => {
      expect(value, `${path} must not be undefined`).not.toBeUndefined()
      if (Array.isArray(value)) value.forEach((entry, index) => assertJson(entry, `${path}[${index}]`))
      else if (value && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}.${key}`)
      }
    }
    assertJson(inactive)
    expect(Object.hasOwn(inactive.rules[0], "reason")).toBe(false)
    expect(Object.hasOwn(inactive.rules[0], "detail")).toBe(false)
    expect(Object.hasOwn(inactive.rules[0], "error")).toBe(false)
    await engine.context("s", context("@review"))
    assertJson(engine.snapshot("s"))
  })

  test("agent-selected rules require a tool selection and expire at a new turn", async () => {
    const { engine } = await engineFixture(files)
    await engine.context("s", context("Implement backend"))
    await engine.load("s", ["backend"])
    expect(engine.snapshot("s").rules.find(r => r.id === "backend.mdc")?.active).toBe(false)
    expect(await engine.context("s", context("Implement backend", [], ["backend.mdc"]))).toContain("BACKEND_SENTINEL")
    expect(await engine.context("s", context("Another task", [], [], "user-2"))).not.toContain("BACKEND_SENTINEL")
    await expect(engine.load("s", ["review"])).rejects.toThrow("only description-selected")
  })

  test("manual rules deactivate when the user turn changes; retained file context still matches", async () => {
    const { engine } = await engineFixture(files)
    await engine.context("s", context("@review", ["src/App.tsx"]))
    const next = await engine.context("s", context("Continue coding", ["src/App.tsx"], [], "user-2"))
    expect(next).not.toContain("REVIEW_SENTINEL")
    expect(next).toContain("REACT_SENTINEL")
    const third = await engine.context("s", context("Work elsewhere", [], [], "user-3"))
    expect(third).not.toContain("REACT_SENTINEL")
  })

  test("synthetic compaction continuation preserves the task, then new user resets it", async () => {
    const { engine } = await engineFixture(files)
    await engine.context("s", context("@review", ["src/App.tsx"], ["backend"]))
    const continued = await engine.context("s", context("", [], [], ""))
    expect(continued).toContain("REVIEW_SENTINEL")
    expect(continued).toContain("BACKEND_SENTINEL")
    expect(continued).toContain("REACT_SENTINEL")
    expect(await engine.context("s", context("Fresh task", [], [], "user-2"))).not.toContain("REVIEW_SENTINEL")
  })

  test("relative IDs resolve collisions without enabling both rules", async () => {
    const { engine } = await engineFixture({ "a/review.mdc": "A_SENTINEL", "b/review.mdc": "B_SENTINEL" })
    const ambiguous = await engine.context("s", context("@review"))
    expect(ambiguous).toContain("Ambiguous rule")
    expect(engine.snapshot("s").rules.some(r => r.active)).toBe(false)
    const exact = await engine.context("s", context("@a/review.mdc"))
    expect(exact).toContain("A_SENTINEL")
    expect(exact).not.toContain("B_SENTINEL")
    expect(resolveRule("a/review", engine.catalog.rules).rule?.id).toBe("a/review.mdc")
  })

  test("references resolve beside a rule or at project root; cycles terminate", async () => {
    const { engine, write } = await engineFixture({
      "a.mdc": "---\nalwaysApply: true\n---\nA_SENTINEL\n@nested/b\n@template.ts",
      "nested/b.mdc": "B_SENTINEL\n@a",
    })
    await write("template.ts", "TEMPLATE_SENTINEL")
    const text = await engine.context("s", context())
    expect(text.match(/A_SENTINEL/g)).toHaveLength(1)
    expect(text).toContain("B_SENTINEL")
    expect(text).toContain("TEMPLATE_SENTINEL")
    expect(engine.snapshot("s").rules.find(r => r.id === "nested/b.mdc")?.reason).toBe("reference")
  })

  test("unresolved rule-body mentions are ignored", async () => {
    const { engine } = await engineFixture({
      "general.mdc": "---\nalwaysApply: true\n---\nGENERAL_SENTINEL\nAsk @agent to use @skill.",
    })
    const text = await engine.context("s", context())
    expect(text).toContain("GENERAL_SENTINEL")
    expect(engine.snapshot("s").warnings).toEqual([])
  })

  test("live discovery supports missing directory, changes, additions and deletions", async () => {
    const { root, engine, write } = await engineFixture({}, true)
    await write(".opencode/rules/nested/new.md", "BEFORE")
    await eventually(() => engine.catalog.rules.length === 1)
    await engine.context("s", context())
    await write(".opencode/rules/nested/new.md", "AFTER")
    await eventually(() => engine.snapshot("s").rules[0]?.pending === true)
    expect(engine.snapshot("s").rules[0].active).toBe(true)
    expect(await engine.context("s", context())).toContain("AFTER")
    expect(engine.snapshot("s").rules[0].pending).toBe(false)
    await rm(path.join(root, ".opencode/rules/nested/new.md"))
    await eventually(() => engine.catalog.rules.length === 0)
    expect(await engine.context("s", context())).toBe("")
  })
})

test("mentions avoid emails and fenced examples, support quoted paths", () => {
  expect(mentions('Use @frontend/react.mdc and @"path with spaces.md". mail me at a@b.com\n```md\n@ignore\n```')).toEqual(["frontend/react.mdc", "path with spaces.md"])
})

test("root resolution respects worktrees and non-Git locations", () => {
  const root = path.resolve("worktree")
  expect(projectRoot(path.join(root, "nested"), root)).toBe(root)
  expect(projectRoot(root, path.parse(root).root)).toBe(root)
  expect(relativeFile(root, path.resolve(root, "../outside.ts"))).toBeUndefined()
  expect(relativeFile(root, path.join(root, "src", "App.tsx"))).toBe("src/App.tsx")
})
