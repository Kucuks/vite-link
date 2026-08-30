import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ResolvedViteLinkConfig } from '../types'

export async function validateResolvedViteLinkConfig(
  config: ResolvedViteLinkConfig,
): Promise<void> {
  const errors = [
    ...validateDev(config),
    ...(await validateBuild(config)),
    ...validateAdapters(config),
    ...validateMetadata(config),
    ...validateAssets(config),
  ]
  if (errors.length === 0) return
  throw new Error(`Invalid Vite Link configuration:\n- ${errors.join('\n- ')}`)
}

function validateDev(config: ResolvedViteLinkConfig): string[] {
  const errors: string[] = []
  if (!Number.isInteger(config.dev.port) || config.dev.port < 0 || config.dev.port > 65_535) {
    errors.push('`dev.port` must be an integer between 0 and 65535.')
  }
  if (!Number.isFinite(config.dev.debounce) || config.dev.debounce < 0) {
    errors.push('`dev.debounce` must be a non-negative finite number.')
  }
  if (!Number.isFinite(config.dev.gracefulTimeout) || config.dev.gracefulTimeout < 0) {
    errors.push('`dev.gracefulTimeout` must be a non-negative finite number.')
  }
  return errors
}

async function validateBuild(config: ResolvedViteLinkConfig): Promise<string[]> {
  const errors: string[] = []
  if (typeof config.build.outDir !== 'string' || !config.build.outDir.trim()) {
    errors.push('`build.outDir` must be a non-empty string.')
  } else if (!(await isPathContained(config.root, resolve(config.root, config.build.outDir)))) {
    errors.push('`build.outDir` must resolve inside the project root.')
  }
  for (const [name, value] of [
    ['build.entryFileName', config.build.entryFileName],
    ['build.chunkFileNames', config.build.chunkFileNames],
  ] as const) {
    if (typeof value !== 'string' || !value.trim() || isAbsoluteOrParentPath(value)) {
      errors.push(`\`${name}\` must be a relative path inside the build output directory.`)
    }
  }
  return errors
}

async function isPathContained(root: string, target: string): Promise<boolean> {
  const absoluteRoot = resolve(root)
  const absoluteTarget = resolve(target)
  if (isOutside(relative(absoluteRoot, absoluteTarget))) return false

  const [realRoot, realTargetAncestor] = await Promise.all([
    realpath(absoluteRoot),
    findNearestExistingRealPath(absoluteTarget),
  ])
  return !isOutside(relative(realRoot, realTargetAncestor))
}

async function findNearestExistingRealPath(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await realpath(current)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

function isOutside(relativePath: string): boolean {
  return (
    relativePath === '..' || relativePath.startsWith(`..${separator}`) || isAbsolute(relativePath)
  )
}

const separator = process.platform === 'win32' ? '\\' : '/'

function validateAdapters(config: ResolvedViteLinkConfig): string[] {
  const errors: string[] = []
  const names = new Set<string>()
  for (const adapter of config.adapters) {
    const name = typeof adapter.name === 'string' ? adapter.name.trim() : ''
    if (!name) {
      errors.push('Every adapter must have a non-empty name.')
      continue
    }
    if (names.has(name)) errors.push(`Adapter name \`${name}\` is configured more than once.`)
    names.add(name)
  }
  return errors
}

function validateMetadata(config: ResolvedViteLinkConfig): string[] {
  return config.metadata.commands.some((command) => typeof command !== 'string' || !command.trim())
    ? ['`metadata.commands` must not contain empty commands.']
    : []
}

function validateAssets(config: ResolvedViteLinkConfig): string[] {
  const errors: string[] = []
  for (const [index, asset] of config.assets.entries()) {
    const includes = Array.isArray(asset.include) ? asset.include : [asset.include]
    if (
      includes.length === 0 ||
      includes.some((pattern) => typeof pattern !== 'string' || !pattern.trim())
    ) {
      errors.push(`\`assets[${index}].include\` must contain at least one non-empty pattern.`)
    }
  }
  return errors
}

function isAbsoluteOrParentPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  )
}
