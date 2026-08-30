import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import ts from 'typescript'
import { fileExists } from './fs'

export interface TsconfigReadResult {
  path: string
  json: Record<string, unknown>
}

export async function readTsconfig(path: string): Promise<TsconfigReadResult> {
  const absolute = resolve(path)
  const json = await readTsconfigJson(absolute)
  const merged = await mergeExtends(absolute, json, new Set<string>())
  return { path: absolute, json: merged }
}

async function readTsconfigJson(path: string): Promise<Record<string, unknown>> {
  const result = ts.readConfigFile(path, ts.sys.readFile)
  if (result.error) {
    const message = ts.flattenDiagnosticMessageText(result.error.messageText, '\n')
    throw new Error(`Failed to read tsconfig ${path}: ${message}`)
  }
  return result.config as Record<string, unknown>
}

async function mergeExtends(
  path: string,
  json: Record<string, unknown>,
  seen: Set<string>,
): Promise<Record<string, unknown>> {
  if (seen.has(path)) {
    throw new Error(`Circular tsconfig extends chain detected at ${path}`)
  }
  seen.add(path)

  const extensions = normalizeExtends(json.extends)
  if (extensions.length === 0) return normalizePathSensitiveOptions(path, json)

  let mergedBase: Record<string, unknown> = {}
  for (const extension of extensions) {
    const basePath = await resolveExtends(path, extension)
    if (!basePath) {
      throw new Error(`Failed to resolve extended tsconfig "${extension}" from ${path}`)
    }

    const baseJson = await readTsconfigJson(basePath)
    const merged = await mergeExtends(basePath, baseJson, new Set(seen))
    mergedBase = deepMerge(mergedBase, merged)
  }
  const merged = deepMerge(mergedBase, { ...json, extends: undefined })
  return normalizePathSensitiveOptions(path, merged)
}

function normalizeExtends(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  return []
}

async function resolveExtends(path: string, ext: string): Promise<string | undefined> {
  const candidates: string[] = []

  if (ext.startsWith('.')) {
    candidates.push(resolve(dirname(path), ext.endsWith('.json') ? ext : `${ext}.json`))
  } else if (isAbsolute(ext)) {
    candidates.push(ext.endsWith('.json') ? ext : `${ext}.json`)
  } else {
    const req = createRequire(path)
    for (const request of [
      ext,
      ext.endsWith('.json') ? ext : `${ext}.json`,
      `${ext}/tsconfig.json`,
    ]) {
      try {
        candidates.push(req.resolve(request))
      } catch {
        // Continue with the next resolution form.
      }
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }

  return undefined
}

function normalizePathSensitiveOptions(
  path: string,
  json: Record<string, unknown>,
): Record<string, unknown> {
  const compilerOptions = getCompilerOptions(json)
  const output = { ...json, compilerOptions: { ...compilerOptions } }
  const normalized = output.compilerOptions as Record<string, unknown>

  if (typeof normalized.baseUrl === 'string' && !isAbsolute(normalized.baseUrl)) {
    normalized.baseUrl = resolve(dirname(path), normalized.baseUrl)
  }

  return output
}

export function getCompilerOptions(tsconfig: Record<string, unknown>): Record<string, unknown> {
  const options = tsconfig.compilerOptions
  return options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
}

export function getTsconfigPaths(tsconfig: Record<string, unknown>): Record<string, string[]> {
  const options = getCompilerOptions(tsconfig)
  const paths = options.paths
  if (!paths || typeof paths !== 'object') return {}

  const output: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(paths as Record<string, unknown>)) {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      output[key] = value as string[]
    }
  }
  return output
}

export function getBaseUrl(tsconfig: Record<string, unknown>, tsconfigPath: string): string {
  const options = getCompilerOptions(tsconfig)
  const baseUrl = options.baseUrl
  if (typeof baseUrl === 'string')
    return isAbsolute(baseUrl) ? baseUrl : resolve(dirname(tsconfigPath), baseUrl)
  return dirname(tsconfigPath)
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a }

  for (const [key, value] of Object.entries(b)) {
    if (value === undefined) continue

    const current = result[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value)
    } else {
      result[key] = value
    }
  }

  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
