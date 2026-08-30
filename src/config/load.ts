import { resolve } from 'node:path'
import { loadConfigFromFile, mergeConfig, type PluginOption, type UserConfig } from 'vite'
import type { LoadedViteLinkConfig, ViteLinkOptions, ViteLinkPlugin } from '../types'

export async function loadViteLinkConfig(options: {
  root: string | undefined
  configFile: string | undefined
  command: 'serve' | 'build'
  mode: string
}): Promise<LoadedViteLinkConfig> {
  const root = resolve(options.root ?? process.cwd())
  const loaded = await loadConfigFromFile(
    { command: options.command, mode: options.mode },
    options.configFile,
    root,
  )

  const viteConfig = loaded?.config ?? {}
  const viteLinkOptions =
    findViteLinkOptions(viteConfig.plugins) ?? readInlineViteLinkOptions(viteConfig) ?? {}

  return {
    viteConfig: stripViteLinkPlugins(viteConfig),
    viteLinkOptions: { root, ...viteLinkOptions },
    configFile: loaded?.path,
  }
}

export function mergeUserViteConfig(base: UserConfig, user: UserConfig): UserConfig {
  const { viteLink: _viteLink, ...userWithoutViteLink } = user as UserConfig & {
    viteLink?: ViteLinkOptions
  }
  void _viteLink
  return mergeConfig(stripViteLinkPlugins(userWithoutViteLink), base)
}

export function stripViteLinkPlugins(config: UserConfig): UserConfig {
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
      ('__viteLink' in item || ('__viteLinkManaged' in item && item.__viteLinkManaged === true))
    ) {
      continue
    }
    output.push(item)
  }

  return output
}

function findViteLinkOptions(
  plugins: PluginOption | PluginOption[] | undefined,
): ViteLinkOptions | undefined {
  if (!plugins) return undefined
  const list = Array.isArray(plugins) ? plugins : [plugins]

  for (const item of list) {
    if (!item) continue
    if (Array.isArray(item)) {
      const nested = findViteLinkOptions(item)
      if (nested) return nested
      continue
    }

    if (typeof item === 'object' && '__viteLink' in item) {
      return (item as ViteLinkPlugin).__viteLink?.options
    }
  }

  return undefined
}

function readInlineViteLinkOptions(config: UserConfig): ViteLinkOptions | undefined {
  const maybe = (config as UserConfig & { viteLink?: ViteLinkOptions }).viteLink
  return maybe && typeof maybe === 'object' ? maybe : undefined
}
