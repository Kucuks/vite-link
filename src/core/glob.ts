import { relative } from 'node:path'
import micromatch from 'micromatch'
import { toPosixPath } from './fs'

export function matchesGlobPattern(
  root: string,
  file: string,
  patterns: string | string[],
): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns]
  const relativePath = toPosixPath(relative(root, file))
  const absolutePath = toPosixPath(file)

  return list.some((pattern) => {
    const normalized = toPosixPath(pattern)
    return (
      micromatch.isMatch(relativePath, normalized) || micromatch.isMatch(absolutePath, normalized)
    )
  })
}

export function isExcludedByGlob(
  root: string,
  file: string,
  patterns: string | string[] | undefined,
): boolean {
  if (!patterns) return false
  return matchesGlobPattern(root, file, patterns)
}
