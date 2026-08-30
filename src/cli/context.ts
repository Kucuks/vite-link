import { mergeConfig } from 'vite'
import {
  createViteInlineConfig,
  loadViteLinkConfig,
  mergeUserViteConfig,
  resolveViteLinkConfig,
} from '../config'
import type { ResolvedViteLinkConfig } from '../types'

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
  config: ResolvedViteLinkConfig
  viteConfig: ReturnType<typeof mergeConfig>
}> {
  const loaded = await loadViteLinkConfig({
    root: options.root,
    configFile: options.config,
    command,
    mode: options.mode ?? (command === 'build' ? 'production' : 'development'),
  })

  const diagnostics =
    typeof loaded.viteLinkOptions.diagnostics === 'object'
      ? { ...loaded.viteLinkOptions.diagnostics }
      : loaded.viteLinkOptions.diagnostics

  if (options.strict !== undefined && typeof diagnostics === 'object') {
    diagnostics.strict = options.strict
  }

  const viteLinkOptions = { ...loaded.viteLinkOptions }
  if (diagnostics !== undefined) {
    viteLinkOptions.diagnostics = diagnostics
  }

  const config = await resolveViteLinkConfig(
    viteLinkOptions,
    command === 'build' ? 'production' : 'development',
    options.mode ?? (command === 'build' ? 'production' : 'development'),
  )

  const inline = createViteInlineConfig(config)
  const viteConfig = {
    ...mergeUserViteConfig(inline, loaded.viteConfig),
    configFile: false as const,
    mode: config.mode,
  }

  return { config, viteConfig }
}
