import { resolve } from 'node:path'
import { loadConfigFromFile, mergeConfig, type PluginOption, type UserConfig } from 'vite'
import type { LoadedViteKitConfig, ViteKitOptions, ViteKitPlugin } from '../types'

export async function loadViteKitConfig(options: {
  root: string | undefined
  configFile: string | undefined
  command: 'serve' | 'build'
  mode: string
}): Promise<LoadedViteKitConfig> {
  const root = resolve(options.root ?? process.cwd())
  const loaded = await loadConfigFromFile(
    { command: options.command, mode: options.mode },
    options.configFile,
    root,
  )

  const viteConfig = loaded?.config ?? {}
  const viteKitOptions =
    findViteKitOptions(viteConfig.plugins) ?? readInlineViteKitOptions(viteConfig) ?? {}

  return {
    viteConfig: stripViteKitPlugins(viteConfig),
    viteKitOptions: { root, ...viteKitOptions },
    configFile: loaded?.path,
  }
}

export function mergeUserViteConfig(base: UserConfig, user: UserConfig): UserConfig {
  const { viteKit: _viteKit, ...userWithoutViteKit } = user as UserConfig & {
    viteKit?: ViteKitOptions
  }
  void _viteKit
  return mergeConfig(stripViteKitPlugins(userWithoutViteKit), base)
}

export function stripViteKitPlugins(config: UserConfig): UserConfig {
  if (!config.plugins) return config
  return {
    ...config,
    plugins: filterPluginOptions(config.plugins),
  }
}

function filterPluginOptions(plugins: PluginOption | PluginOption[]): PluginOption[] {
  const list = Array.isArray(plugins) ? plugins : [plugins]
  const output: PluginOption[] = []

  for (const item of list) {
    if (!item) continue
    if (Array.isArray(item)) {
      const nested = filterPluginOptions(item)
      if (nested.length > 0) output.push(nested)
      continue
    }

    if (
      typeof item === 'object' &&
      ('__viteKit' in item || ('__viteKitManaged' in item && item.__viteKitManaged === true))
    ) {
      continue
    }
    output.push(item)
  }

  return output
}

function findViteKitOptions(
  plugins: PluginOption | PluginOption[] | undefined,
): ViteKitOptions | undefined {
  if (!plugins) return undefined
  const list = Array.isArray(plugins) ? plugins : [plugins]

  for (const item of list) {
    if (!item) continue
    if (Array.isArray(item)) {
      const nested = findViteKitOptions(item)
      if (nested) return nested
      continue
    }

    if (typeof item === 'object' && '__viteKit' in item) {
      return (item as ViteKitPlugin).__viteKit?.options
    }
  }

  return undefined
}

function readInlineViteKitOptions(config: UserConfig): ViteKitOptions | undefined {
  const maybe = (config as UserConfig & { viteKit?: ViteKitOptions }).viteKit
  return maybe && typeof maybe === 'object' ? maybe : undefined
}
