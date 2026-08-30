import type { Plugin } from 'vite'
import { copyAssets } from './assets'
import { clearConsole } from './core/console'
import { resolveViteLinkConfig } from './config/defaults'
import { createViteInlineConfig } from './config/vite'
import { reportDiagnostics, runDiagnostics, shouldFailDiagnostics } from './diagnostics'
import type {
  ViteLinkManagedPlugin,
  ViteLinkOptions,
  ViteLinkPlugin,
  ViteLinkPluginOption,
} from './types'

export function viteLink(options: ViteLinkOptions = {}): ViteLinkPluginOption {
  let resolvedConfig: ReturnType<typeof resolveViteLinkConfig> | undefined
  const plugin: ViteLinkPlugin = {
    name: 'vite-link',
    enforce: 'pre',
    __viteLink: { options },

    async config(_, env) {
      resolvedConfig = resolveViteLinkConfig(
        options,
        env.command === 'build' ? 'production' : 'development',
        env.mode,
      )
      const resolved = await resolvedConfig
      clearConsole(resolved.clearScreen)
      return createViteInlineConfig(resolved, { includeAdapterPlugins: false })
    },

    async buildStart() {
      if (process.env.VITE_LINK_CLI_COMMAND === 'dev') return

      const resolved = await (resolvedConfig ??= resolveViteLinkConfig(options, 'production'))
      if (!resolved.diagnostics.enabled) return

      const diagnostics = await runDiagnostics(resolved)
      reportDiagnostics(diagnostics)

      if (
        shouldFailDiagnostics(diagnostics, {
          strict: resolved.diagnostics.strict,
          failOn: resolved.diagnostics.failOn,
        })
      ) {
        throw new Error('vite-link diagnostics failed')
      }
    },

    async closeBundle() {
      const resolved = await (resolvedConfig ??= resolveViteLinkConfig(options, 'production'))
      if (resolved.assets.length > 0) await copyAssets(resolved)
    },

    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (file.endsWith('.ts')) return
        server.config.logger.info(`[vite-link] asset/source changed: ${file}`)
      })
    },
  }

  const adapterPlugins = (options.adapters ?? []).flatMap((adapter) =>
    (adapter.plugins?.(options) ?? []).map(markManagedPlugin),
  )
  return [plugin, ...adapterPlugins]
}

export default viteLink
export type { ViteLinkOptions }

export function defineViteLinkConfig(options: ViteLinkOptions): ViteLinkOptions {
  return options
}

export function isViteLinkPlugin(plugin: Plugin): plugin is ViteLinkPlugin {
  return Boolean((plugin as ViteLinkPlugin).__viteLink)
}

function markManagedPlugin(plugin: Plugin): ViteLinkManagedPlugin {
  return Object.assign(plugin, { __viteLinkManaged: true as const })
}
