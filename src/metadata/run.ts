import chokidar from 'chokidar'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ResolvedViteKitConfig } from '../types'
import { toPosixPath } from '../core/fs'
import { runCommand } from '../typecheck/run'

export async function runMetadataGenerators(config: ResolvedViteKitConfig): Promise<void> {
  if (!config.metadata.enabled) return

  const commands = collectMetadataCommands(config)
  for (const command of commands) {
    await runShellCommand(command, config.root)
  }
}

export interface MetadataWatcher {
  ready: Promise<void>
  close(): Promise<void>
}

export function startMetadataWatcher(
  config: ResolvedViteKitConfig,
  onError: (error: unknown) => void = console.error,
): MetadataWatcher | undefined {
  if (!config.metadata.enabled || !config.metadata.watch) return undefined

  let timer: NodeJS.Timeout | undefined
  let running = false
  let queued = false
  let closed = false
  let currentRun: Promise<void> | undefined

  const run = () => {
    if (closed) return
    if (running) {
      queued = true
      return
    }

    running = true
    currentRun = runMetadataGenerators(config)
      .catch(onError)
      .finally(() => {
        running = false
        currentRun = undefined
        if (queued && !closed) {
          queued = false
          schedule()
        }
      })
  }

  const schedule = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, config.dev.debounce)
  }

  const watcher = chokidar.watch([resolve(config.root, 'src'), resolve(config.root, 'libs')], {
    ignoreInitial: true,
    ignored: (path) => isIgnoredMetadataPath(config, path),
    followSymlinks: false,
  })

  const handle = (path: string) => {
    if (path.endsWith('.ts')) schedule()
  }

  watcher.on('add', handle)
  watcher.on('change', handle)
  watcher.on('unlink', handle)
  watcher.on('error', onError)

  return {
    ready: new Promise<void>((resolveReady) => watcher.once('ready', resolveReady)),
    async close() {
      closed = true
      queued = false
      if (timer) clearTimeout(timer)
      timer = undefined
      await watcher.close()
      await currentRun
    },
  }
}

function isIgnoredMetadataPath(config: ResolvedViteKitConfig, path: string): boolean {
  const normalized = toPosixPath(path)
  if (normalized.split('/').includes('node_modules')) return true
  if (normalized.endsWith('.spec.ts') || normalized.endsWith('.test.ts')) return true

  const outDir = resolve(config.root, config.build.outDir)
  const outputRelative = relative(outDir, path)
  return outputRelative === '' || (!outputRelative.startsWith('..') && !isAbsolute(outputRelative))
}

export function collectMetadataCommands(config: ResolvedViteKitConfig): string[] {
  return [...config.metadata.commands]
}

async function runShellCommand(command: string, cwd: string): Promise<void> {
  const shell = process.platform === 'win32' ? 'cmd' : 'sh'
  const args = process.platform === 'win32' ? ['/c', command] : ['-lc', command]
  await runCommand(shell, args, cwd, { shell: false })
}
