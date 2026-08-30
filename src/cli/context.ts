import { mergeConfig } from 'vite'
import {
  createViteInlineConfig,
  loadViteKitConfig,
  mergeUserViteConfig,
  resolveViteKitConfig,
} from '../config'
import type { ResolvedViteKitConfig } from '../types'

export interface CliGlobalOptions {
  root?: string
  config?: string
  mode?: string
  strict?: boolean
}

export async function createCliContext(
  options: CliGlobalOptions,
  command: 'serve' | 'build',
): Promise<{
  config: ResolvedViteKitConfig
  viteConfig: ReturnType<typeof mergeConfig>
}> {
  const loaded = await loadViteKitConfig({
    root: options.root,
    configFile: options.config,
    command,
    mode: options.mode ?? (command === 'build' ? 'production' : 'development'),
  })

  const diagnostics =
    typeof loaded.viteKitOptions.diagnostics === 'object'
      ? { ...loaded.viteKitOptions.diagnostics }
      : loaded.viteKitOptions.diagnostics

  if (options.strict !== undefined && typeof diagnostics === 'object') {
    diagnostics.strict = options.strict
  }

  const viteKitOptions = { ...loaded.viteKitOptions }
  if (diagnostics !== undefined) {
    viteKitOptions.diagnostics = diagnostics
  }

  const config = await resolveViteKitConfig(
    viteKitOptions,
    command === 'build' ? 'production' : 'development',
    options.mode ?? (command === 'build' ? 'production' : 'development'),
  )

  const inline = createViteInlineConfig(config)
  const viteConfig = {
    ...mergeUserViteConfig(inline, loaded.viteConfig),
    configFile: false as const,
  }

  return { config, viteConfig }
}
