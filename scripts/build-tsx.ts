// Pre-compiles src .tsx files to .js using the same babel-preset-solid
// transform that OpenCode's runtime plugin applies to non-node_modules files.
//
// Why: OpenCode's embedded @opentui/solid Bun plugin excludes any path
// containing "node_modules" from the Solid JSX transform. When this package is
// installed from npm, our .tsx sources live under node_modules and therefore
// never receive the reactive-getter transform — JSX props are evaluated
// eagerly once and the sidebar freezes at "Connecting to rules server…".
//
// Shipping pre-compiled .js makes both install modes (local dir and npm)
// load identical, already-transformed code.
import { transformAsync } from "@babel/core"
// @ts-expect-error Babel presets do not publish TypeScript declarations.
import ts from "@babel/preset-typescript"
// @ts-expect-error Babel presets do not publish TypeScript declarations.
import solid from "babel-preset-solid"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

async function findTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await findTsxFiles(full))
    else if (entry.name.endsWith(".tsx")) files.push(full)
  }
  return files
}

/** Rewrite relative .tsx import specifiers to .js so compiled output loads compiled siblings. */
function rewriteSpecifiers(code: string): string {
  return code.replace(
    /(\bfrom\s+["']|\bimport\s*\(\s*["'])(\.[^"']+?)\.tsx(["'])/g,
    (_match, prefix: string, spec: string, quote: string) => `${prefix}${spec}.js${quote}`,
  )
}

const root = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const files = await findTsxFiles(root)
for (const file of files) {
  const source = await readFile(file, "utf8")
  const result = await transformAsync(source, {
    filename: file,
    configFile: false,
    babelrc: false,
    presets: [
      [solid, { moduleName: "@opentui/solid", generate: "universal" }],
      [ts, { isTSX: true, allExtensions: true }],
    ],
  })
  if (!result?.code) throw new Error(`babel transform produced no output for ${file}`)
  const outPath = file.replace(/\.tsx$/, ".js")
  await writeFile(outPath, rewriteSpecifiers(result.code), "utf8")
  console.log(`compiled ${relative(root, file)} -> ${relative(root, outPath)}`)
}
console.log(`done: ${files.length} file(s)`)
