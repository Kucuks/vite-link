import type { Plugin } from 'vite'
import { copyAssets } from './assets'
import { clearConsole } from './core/console'
import { resolveViteKitConfig } from './config/defaults'
import { createViteInlineConfig } from './config/vite'
import { reportDiagnostics, runDiagnostics, shouldFailDiagnostics } from './diagnostics'
import type {
  ViteKitManagedPlugin,
  ViteKitOptions,
  ViteKitPlugin,
  ViteKitPluginOption,
} from './types'

export function viteKit(options: ViteKitOptions = {}): ViteKitPluginOption {
  let resolvedConfig: ReturnType<typeof resolveViteKitConfig> | undefined
  const plugin: ViteKitPlugin = {
    name: 'vite-kit',
    enforce: 'pre',
    __viteKit: { options },

    async config(_, env) {
      resolvedConfig = resolveViteKitConfig(
        options,
        env.command === 'build' ? 'production' : 'development',
        env.mode,
      )
      const resolved = await resolvedConfig
      clearConsole(resolved.clearScreen)
      return createViteInlineConfig(resolved, { includeAdapterPlugins: false })
    },

    async buildStart() {
      if (process.env.VITE_KIT_CLI_COMMAND === 'dev') return

      const resolved = await (resolvedConfig ??= resolveViteKitConfig(options, 'production'))
      if (!resolved.diagnostics.enabled) return

      const diagnostics = await runDiagnostics(resolved)
      reportDiagnostics(diagnostics)

      if (
        shouldFailDiagnostics(diagnostics, {
          strict: resolved.diagnostics.strict,
          failOn: resolved.diagnostics.failOn,
        })
      ) {
        throw new Error('vite-kit diagnostics failed')
      }
    },

    async closeBundle() {
      const resolved = await (resolvedConfig ??= resolveViteKitConfig(options, 'production'))
      if (resolved.assets.length > 0) await copyAssets(resolved)
    },

    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.endsWith('.ts')) return
        server.config.logger.info(`[vite-kit] asset/source changed: ${file}`)
      })
    },
  }

  const adapterPlugins = (options.adapters ?? []).flatMap((adapter) =>
    (adapter.plugins?.(options) ?? []).map(markManagedPlugin),
  )
  return [plugin, ...adapterPlugins]
}

export default viteKit
export type { ViteKitOptions }

export function defineViteKitConfig(options: ViteKitOptions): ViteKitOptions {
  return options
}

export function isViteKitPlugin(plugin: Plugin): plugin is ViteKitPlugin {
  return Boolean((plugin as ViteKitPlugin).__viteKit)
}

function markManagedPlugin(plugin: Plugin): ViteKitManagedPlugin {
  return Object.assign(plugin, { __viteKitManaged: true as const })
}
