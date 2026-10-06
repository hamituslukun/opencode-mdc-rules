import path from "node:path"
import { fileURLToPath } from "node:url"

export const slash = (value: string) => value.replaceAll("\\", "/")

export function projectRoot(directory: string, worktree?: string, override?: string): string {
  if (override) return path.resolve(directory, override)
  // V1 uses the filesystem root as its sentinel for a non-VCS project.
  if (worktree && path.resolve(worktree) !== path.parse(path.resolve(worktree)).root) return path.resolve(worktree)
  return path.resolve(directory)
}

export function relativeFile(root: string, value: string): string | undefined {
  try {
    const file = value.startsWith("file:") ? fileURLToPath(value) : value
    const absolute = path.resolve(root, file)
    const relative = path.relative(root, absolute)
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
    return slash(relative)
  } catch {
    return
  }
}

/** Also used for cross-process cache keys on Windows. */
export function pathKey(value: string): string {
  const result = slash(path.resolve(value))
  return process.platform === "win32" ? result.toLowerCase() : result
}
