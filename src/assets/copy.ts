import { copyFile, lstat, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import fg from 'fast-glob'
import type { AssetPattern, ResolvedViteLinkConfig } from '../types'
import { mapConcurrent } from '../core/concurrency'
import { ensureDir, fileExists, toPosixPath } from '../core/fs'
import { isExcludedByGlob, matchesGlobPattern } from '../core/glob'

export interface AssetCopyResult {
  copied: number
  removed: number
  files: string[]
}

export async function copyAssets(
  config: ResolvedViteLinkConfig,
  protectedOutputs: ReadonlySet<string> = collectEmittedOutputPaths(config),
): Promise<AssetCopyResult> {
  const tasks: Array<{ source: string; target: string; outDir: string }> = []
  const targetOwners = new Map<string, string>()
  const protectedTargets = normalizeProtectedOutputs(protectedOutputs)

  for (const pattern of config.assets) {
    const matches = await matchAssetFiles(config.root, pattern)
    for (const file of matches) {
      const { target, outDir } = resolveAssetMapping(
        config.root,
        config.build.outDir,
        pattern,
        file,
      )
      const targetKey = normalizeTargetKey(target)
      assertNotProtectedOutput(protectedTargets, target)
      const previous = targetOwners.get(targetKey)
      if (previous && previous !== file) {
        throw new Error(`Asset target collision: ${previous} and ${file} both map to ${target}`)
      }
      if (previous) continue
      targetOwners.set(targetKey, file)
      tasks.push({ source: file, target, outDir })
    }
  }

  const files = await mapConcurrent(
    tasks,
    ASSET_COPY_CONCURRENCY,
    async ({ source, target, outDir }) => {
      await assertRealAssetSourceContained(config.root, source)
      await ensureDir(dirname(target))
      await assertRealAssetTargetContained(config.root, outDir, target)
      await copyFile(source, target)
      return target
    },
  )

  return { copied: files.length, removed: 0, files }
}

export async function copyChangedAsset(
  config: ResolvedViteLinkConfig,
  file: string,
  protectedOutputs: ReadonlySet<string> = collectEmittedOutputPaths(config),
): Promise<{ copied: boolean; removed: boolean; restart: boolean; target?: string }> {
  const absolute = isAbsolute(file) ? file : resolve(config.root, file)
  const pattern = findMatchingAssetPattern(config, absolute)
  if (!pattern) return { copied: false, removed: false, restart: false }

  const { target, outDir } = resolveAssetMapping(
    config.root,
    config.build.outDir,
    pattern,
    absolute,
  )
  assertNotProtectedOutput(normalizeProtectedOutputs(protectedOutputs), target)
  if (await fileExists(absolute)) {
    await assertRealAssetSourceContained(config.root, absolute)
    await ensureDir(dirname(target))
    await assertRealAssetTargetContained(config.root, outDir, target)
    await copyFile(absolute, target)
    return { copied: true, removed: false, restart: pattern.restart ?? false, target }
  }

  if (await fileExists(target)) {
    await assertRealAssetTargetContained(config.root, outDir, target)
    await rm(target, { force: true })
  }
  return { copied: false, removed: true, restart: pattern.restart ?? false, target }
}

export function findMatchingAssetPattern(
  config: ResolvedViteLinkConfig,
  file: string,
): AssetPattern | undefined {
  const absolute = isAbsolute(file) ? file : resolve(config.root, file)

  for (const pattern of config.assets) {
    if (!matchesGlobPattern(config.root, absolute, pattern.include)) continue
    if (isExcludedByGlob(config.root, absolute, pattern.exclude)) continue
    return pattern
  }

  return undefined
}

async function matchAssetFiles(root: string, pattern: AssetPattern): Promise<string[]> {
  const include = Array.isArray(pattern.include) ? pattern.include : [pattern.include]
  const exclude = Array.isArray(pattern.exclude)
    ? pattern.exclude
    : pattern.exclude
      ? [pattern.exclude]
      : []

  return fg(include, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**', ...exclude],
    followSymbolicLinks: false,
  })
}

export function resolveAssetTarget(
  root: string,
  buildOutDir: string,
  pattern: AssetPattern,
  file: string,
): string {
  return resolveAssetMapping(root, buildOutDir, pattern, file).target
}

function resolveAssetMapping(
  root: string,
  buildOutDir: string,
  pattern: AssetPattern,
  file: string,
): { target: string; outDir: string } {
  const base = resolve(root, pattern.base ?? inferBase(pattern))
  const outDir = resolve(root, pattern.outDir ?? buildOutDir)
  const rel = relative(base, file)
  if (isOutside(rel)) {
    throw new Error(`Asset source is outside its configured base: ${file}`)
  }

  const target = resolve(outDir, rel)
  const targetRelative = relative(outDir, target)
  if (isOutside(targetRelative)) {
    throw new Error(`Asset target escapes its configured output directory: ${target}`)
  }
  return { target, outDir }
}

function inferBase(pattern: AssetPattern): string {
  const first = Array.isArray(pattern.include) ? pattern.include[0] : pattern.include
  if (!first) return '.'
  const wildcardIndex = first.search(/[*{]/)
  const prefix = wildcardIndex === -1 ? dirname(first) : first.slice(0, wildcardIndex)
  const clean = prefix.replace(/[/\\][^/\\]*$/, '')
  return toPosixPath(clean || '.')
}

async function assertRealAssetSourceContained(root: string, file: string): Promise<void> {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)])
  if (isOutside(relative(realRoot, realFile))) {
    throw new Error(`Asset source resolves outside the project root: ${file}`)
  }
}

async function assertRealAssetTargetContained(
  root: string,
  outDir: string,
  target: string,
): Promise<void> {
  await ensureDir(outDir)
  const [realRoot, realOutDir, realTargetParent] = await Promise.all([
    realpath(root),
    realpath(outDir),
    realpath(dirname(target)),
  ])
  if (isOutside(relative(realRoot, realOutDir))) {
    throw new Error(`Asset output directory resolves outside the project root: ${outDir}`)
  }
  if (isOutside(relative(realOutDir, realTargetParent))) {
    throw new Error(`Asset target resolves outside its output directory: ${target}`)
  }
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`Asset target must not be a symbolic link: ${target}`)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

/** Collect the emitted entry, chunks and assets reported by a Vite build. */
export function collectEmittedOutputPaths(
  config: ResolvedViteLinkConfig,
  buildResult?: unknown,
): Set<string> {
  const outDir = resolve(config.root, config.build.outDir)
  const paths = new Set<string>([resolve(outDir, config.build.entryFileName)])
  const results = Array.isArray(buildResult) ? buildResult : [buildResult]
  for (const result of results) {
    if (!result || typeof result !== 'object' || !('output' in result)) continue
    const output = result.output
    if (!Array.isArray(output)) continue
    for (const item of output) {
      if (!item || typeof item !== 'object' || !('fileName' in item)) continue
      if (typeof item.fileName === 'string') {
        const emittedPath = resolve(outDir, item.fileName)
        paths.add(emittedPath)
        if (
          'type' in item &&
          item.type === 'chunk' &&
          (config.build.sourcemap === true || config.build.sourcemap === 'hidden')
        ) {
          paths.add(`${emittedPath}.map`)
        }
      }
    }
  }
  return paths
}

function normalizeProtectedOutputs(paths: ReadonlySet<string>): Set<string> {
  return new Set([...paths].map((path) => normalizeTargetKey(resolve(path))))
}

function assertNotProtectedOutput(protectedTargets: ReadonlySet<string>, target: string): void {
  if (protectedTargets.has(normalizeTargetKey(target))) {
    throw new Error(`Asset target collision with emitted build output: ${target}`)
  }
}

function normalizeTargetKey(target: string): string {
  return process.platform === 'win32' ? target.toLowerCase() : target
}

function isOutside(relativePath: string): boolean {
  return (
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  )
}

const ASSET_COPY_CONCURRENCY = 16
