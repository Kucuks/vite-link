import chokidar from 'chokidar'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ResolvedViteKitConfig } from '../types'
import { TaskQueue } from '../core/concurrency'
import { toPosixPath } from '../core/fs'
import { copyChangedAsset } from './copy'

export interface AssetWatcher {
  ready: Promise<void>
  close(): Promise<void>
}

export function watchAssets(
  config: ResolvedViteKitConfig,
  onRestartRequired: (file: string) => void | Promise<void>,
  onError: (error: unknown) => void = console.error,
): AssetWatcher | undefined {
  if (config.assets.length === 0) return undefined

  const watcher = chokidar.watch(getAssetWatchRoots(config), {
    ignoreInitial: true,
    ignored: (path) => isIgnoredWatchPath(config, path),
    followSymlinks: false,
  })
  const pending = new Map<string, Promise<void>>()
  const queue = new TaskQueue(ASSET_WATCH_CONCURRENCY)
  const ready = new Promise<void>((resolveReady) => watcher.once('ready', resolveReady))

  const handle = (file: string) => {
    const absolute = isAbsolute(file) ? file : resolve(config.root, file)
    const previous = pending.get(absolute) ?? Promise.resolve()
    let task: Promise<void>
    task = previous
      .catch(() => {})
      .then(() =>
        queue.add(async () => {
          const result = await copyChangedAsset(config, absolute)
          if (result.restart) await onRestartRequired(absolute)
        }),
      )
      .catch(onError)
      .finally(() => {
        if (pending.get(absolute) === task) pending.delete(absolute)
      })
    pending.set(absolute, task)
  }

  watcher.on('add', handle)
  watcher.on('change', handle)
  watcher.on('unlink', handle)
  watcher.on('error', onError)

  return {
    ready,
    async close() {
      await watcher.close()
      await Promise.allSettled(pending.values())
      await queue.onIdle()
    },
  }
}

export function getAssetWatchRoots(config: ResolvedViteKitConfig): string[] {
  const roots = new Set<string>()
  for (const asset of config.assets) {
    const includes = Array.isArray(asset.include) ? asset.include : [asset.include]
    for (const include of includes) {
      const absolute = isAbsolute(include) ? include : resolve(config.root, include)
      const watchRoot = getStaticWatchParent(absolute)
      if (isOutside(relative(config.root, watchRoot))) {
        throw new Error(`Asset watch root is outside the project root: ${watchRoot}`)
      }
      roots.add(watchRoot)
    }
  }
  return [...roots]
}

function isOutside(relativePath: string): boolean {
  return (
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  )
}

const ASSET_WATCH_CONCURRENCY = 16

function getStaticWatchParent(pattern: string): string {
  const normalized = toPosixPath(pattern)
  const wildcardIndex = normalized.search(/[*?{[]/)
  if (wildcardIndex === -1) return dirname(pattern)

  const prefix = normalized.slice(0, wildcardIndex)
  const separatorIndex = prefix.lastIndexOf('/')
  if (separatorIndex === -1) return process.cwd()
  const parent = prefix.slice(0, separatorIndex)
  return parent || '/'
}

function isIgnoredWatchPath(config: ResolvedViteKitConfig, path: string): boolean {
  const normalized = toPosixPath(path)
  if (normalized.split('/').includes('node_modules')) return true

  const outDir = resolve(config.root, config.build.outDir)
  const outputRelative = relative(outDir, path)
  return outputRelative === '' || (!outputRelative.startsWith('..') && !isAbsolute(outputRelative))
}
