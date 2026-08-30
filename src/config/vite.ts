import { resolve } from 'node:path'
import type { UserConfig } from 'vite'
import { createTsconfigPathResolverPlugin } from '../core/alias'
import { matchesPattern } from '../core/match'
import type { ResolvedViteKitConfig } from '../types'
import { looksLikeSecretName } from '../core/env-policy'

export function createViteInlineConfig(
  config: ResolvedViteKitConfig,
  options: { includeAdapterPlugins?: boolean } = {},
): UserConfig {
  const format: 'es' | 'cjs' = config.build.format === 'esm' ? 'es' : 'cjs'
  const externalPredicate = createExternalPredicate(config)
  const ssrExternal = [...config.external.include, ...config.external.alwaysExternal].filter(
    (pattern): pattern is string =>
      typeof pattern === 'string' &&
      !matchesPattern(pattern, config.external.noExternal) &&
      !matchesPattern(pattern, config.external.exclude),
  )
  const bundlerOptions = {
    external: externalPredicate,
    output: {
      format,
      entryFileNames: config.build.entryFileName,
      chunkFileNames: config.build.chunkFileNames,
      preserveModules: config.build.preserveModules,
    },
  }

  return {
    root: config.root,
    clearScreen: config.clearScreen,
    plugins: [
      createTsconfigPathResolverPlugin(config.tsconfigRaw, config.tsconfig),
      ...(options.includeAdapterPlugins === false
        ? []
        : config.adapters.flatMap(
            (adapter) =>
              adapter.plugins?.({
                ...config.originalOptions,
                root: config.root,
                adapters: config.adapters,
              }) ?? [],
          )),
    ],
    appType: 'custom',
    resolve: {
      dedupe: config.monorepo.dedupe,
    },
    ssr: {
      target: 'node',
      external: [...new Set(ssrExternal)],
      noExternal: [...config.external.noExternal, ...config.external.exclude],
    },
    define: createEnvDefine(config),
    build: {
      ssr: config.entry,
      outDir: resolve(config.root, config.build.outDir),
      emptyOutDir: config.build.emptyOutDir,
      sourcemap: config.build.sourcemap,
      minify: config.build.minify,
      target: config.build.target,
      rolldownOptions: bundlerOptions,
    },
  }
}

export function createExternalPredicate(config: ResolvedViteKitConfig) {
  return (id: string): boolean => {
    if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return false
    if (matchesPattern(id, config.external.exclude)) return false
    if (matchesPattern(id, config.external.noExternal)) return false
    if (matchesPattern(id, config.external.alwaysExternal)) return true
    if (matchesPattern(id, config.external.include)) return true
    return false
  }
}

function createEnvDefine(config: ResolvedViteKitConfig): Record<string, string> {
  const define: Record<string, string> = {}

  if (config.env.keepRuntime) {
    define['process.env.NODE_ENV'] = 'process.env.NODE_ENV'
  }

  for (const key of config.env.inline) {
    if (config.env.keepRuntime && key === 'NODE_ENV') continue
    if (config.env.forbidInlineSecrets && looksLikeSecretName(key)) continue
    if (key in process.env) {
      define[`process.env.${key}`] = JSON.stringify(process.env[key])
    }
  }

  return define
}
