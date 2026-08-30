import { realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { toPosixPath } from './fs'
import { getBaseUrl, getTsconfigPaths } from './tsconfig'

export function createTsconfigPathResolverPlugin(
  tsconfig: Record<string, unknown>,
  tsconfigPath: string,
): Plugin {
  const paths = getTsconfigPaths(tsconfig)
  const baseUrl = getBaseUrl(tsconfig, tsconfigPath)
  const cache = new Map<string, string | null>()
  const entries = Object.entries(paths)
    .flatMap(([key, replacements]) => {
      return replacements.map((replacement) => {
        if (key.includes('*')) {
          return {
            key,
            replacement,
            regex: new RegExp(`^${wildcardPatternToRegexSource(key, '(.+)')}$`),
          }
        }

        return { key, replacement, regex: undefined }
      })
    })
    .filter((entry): entry is { key: string; replacement: string; regex?: RegExp } =>
      Boolean(entry.replacement),
    )

  return {
    name: 'vite-kit:module-canonicalizer',
    enforce: 'pre',
    resolveId(source, importer) {
      const sourceId = stripQuery(source)
      const importerId = importer ? stripQuery(importer) : undefined
      const cacheKey = `${importerId ?? ''}\0${sourceId}`
      const cached = cache.get(cacheKey)
      if (cached && isFile(cached)) return cached
      if (cached) cache.delete(cacheKey)

      const resolved =
        resolveTsconfigPath(sourceId, baseUrl, entries) ??
        resolveLocalPath(sourceId, importerId) ??
        null

      if (resolved) {
        if (cache.size >= MODULE_RESOLUTION_CACHE_LIMIT) cache.clear()
        cache.set(cacheKey, resolved)
      }
      return resolved
    },
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.*]/g, '\\$&')
}

function wildcardPatternToRegexSource(pattern: string, capture: string): string {
  return pattern.split('*').map(escapeRegex).join(capture)
}

function resolveExistingModule(target: string): string | undefined {
  const candidates = createModuleCandidates(normalizeDrivePath(target))

  for (const candidate of candidates) {
    if (isFile(candidate)) return canonicalFileId(candidate)
  }

  return undefined
}

function resolveTsconfigPath(
  source: string,
  baseUrl: string,
  entries: Array<{ key: string; replacement: string; regex?: RegExp }>,
): string | undefined {
  if (!source || isVirtualId(source)) return undefined

  for (const entry of entries) {
    if (entry.regex) {
      const match = entry.regex.exec(source)
      if (!match) continue
      const replacement = replaceStars(entry.replacement, match.slice(1))
      const resolved = resolveExistingModule(resolve(baseUrl, replacement))
      if (resolved) return resolved
      continue
    }

    if (source !== entry.key) continue
    const resolved = resolveExistingModule(resolve(baseUrl, entry.replacement))
    if (resolved) return resolved
  }

  return undefined
}

function resolveLocalPath(source: string, importer?: string): string | undefined {
  if (!source || isVirtualId(source) || isBareSpecifier(source)) return undefined

  if (source.startsWith('.')) {
    if (!importer || isVirtualId(importer) || importer.includes('/node_modules/')) return undefined
    return resolveExistingModule(resolve(dirname(normalizeDrivePath(importer)), source))
  }

  if (isAbsoluteSpecifier(source)) {
    const resolved = resolveExistingModule(normalizeDrivePath(source))
    if (resolved?.includes('/node_modules/')) return undefined
    return resolved
  }

  return undefined
}

function createModuleCandidates(target: string): string[] {
  const ext = extname(target)
  const candidates = new Set<string>([target])

  const tsCounterpart = jsToTsExtension(ext)
  if (tsCounterpart) candidates.add(target.slice(0, -ext.length) + tsCounterpart)

  if (!ext) {
    for (const candidateExt of MODULE_EXTENSIONS) {
      candidates.add(`${target}${candidateExt}`)
    }
  }

  for (const candidateExt of MODULE_EXTENSIONS) {
    candidates.add(resolve(target, `index${candidateExt}`))
  }

  return Array.from(candidates)
}

function canonicalFileId(path: string): string {
  return toPosixPath(realpathSync.native(path))
}

function stripQuery(id: string): string {
  const index = id.indexOf('?')
  return index === -1 ? normalizeDrivePath(id) : normalizeDrivePath(id.slice(0, index))
}

function normalizeDrivePath(path: string): string {
  return toPosixPath(path).replace(/^\/([A-Za-z]:\/)/, '$1')
}

function isBareSpecifier(source: string): boolean {
  return !source.startsWith('.') && !isAbsoluteSpecifier(source)
}

function isAbsoluteSpecifier(source: string): boolean {
  return isAbsolute(source) || /^[A-Za-z]:[\\/]/.test(source) || /^\/[A-Za-z]:\//.test(source)
}

function isVirtualId(source: string): boolean {
  return source.startsWith('\0') || source.startsWith('node:') || source.startsWith('data:')
}

function replaceStars(pattern: string, values: string[]): string {
  let index = 0
  return pattern.replaceAll('*', () => values[index++] ?? '')
}

function jsToTsExtension(ext: string): string | undefined {
  if (ext === '.js') return '.ts'
  if (ext === '.mjs') return '.mts'
  if (ext === '.cjs') return '.cts'
  if (ext === '.jsx') return '.tsx'
  return undefined
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const MODULE_RESOLUTION_CACHE_LIMIT = 50_000
const MODULE_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json']
