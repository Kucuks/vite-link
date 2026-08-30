import { resolve } from 'node:path'
import type { ResolvedViteLinkConfig, ViteLinkOptions } from '../types'
import { fileExists } from '../core/fs'
import { readNearestPackageJson } from '../core/package'
import { readTsconfig } from '../core/tsconfig'
import { normalizeAssets } from './normalizers/assets'
import { normalizeBuild } from './normalizers/build'
import { normalizeExternal } from './normalizers/external'
import {
  normalizeDev,
  normalizeDiagnostics,
  normalizeEnv,
  normalizeMetadata,
  normalizeMonorepo,
  normalizeTypecheck,
  type ResolveMode,
} from './normalizers/runtime'
import { validateResolvedViteLinkConfig } from './validate'

export async function resolveViteLinkConfig(
  options: ViteLinkOptions = {},
  mode: ResolveMode = 'development',
  viteMode = mode === 'production' ? 'production' : 'development',
): Promise<ResolvedViteLinkConfig> {
  const root = resolve(options.root ?? process.cwd())
  const entry = resolve(root, options.entry ?? 'src/main.ts')
  const preferredTsconfig = resolve(root, options.tsconfig ?? 'tsconfig.build.json')
  const tsconfigPath = (await fileExists(preferredTsconfig))
    ? preferredTsconfig
    : resolve(root, 'tsconfig.json')
  const tsconfig = await readTsconfig(tsconfigPath)
  const packageInfo = await readNearestPackageJson(root)

  const config: ResolvedViteLinkConfig = {
    root,
    mode: viteMode,
    entry,
    tsconfig: tsconfigPath,
    sourceRoot: resolve(root, options.sourceRoot ?? inferSourceRoot(entry, root)),
    clearScreen: options.clearScreen ?? true,
    build: normalizeBuild(options.build, tsconfig.json, packageInfo.json),
    dev: normalizeDev(options.dev),
    assets: await normalizeAssets(root, options.assets),
    typecheck: normalizeTypecheck(options.typecheck, options.tsconfig ?? tsconfigPath),
    metadata: normalizeMetadata(options.metadata),
    diagnostics: normalizeDiagnostics(options.diagnostics, mode),
    external: normalizeExternal(options.external, packageInfo.json),
    monorepo: normalizeMonorepo(options.monorepo),
    env: normalizeEnv(options.env),
    tsconfigPaths: options.tsconfigPaths ?? true,
    adapters: options.adapters ?? [],
    packageJsonPath: packageInfo.path,
    packageJson: packageInfo.json,
    tsconfigRaw: tsconfig.json,
    originalOptions: options,
  }
  await validateResolvedViteLinkConfig(config)
  return config
}

function inferSourceRoot(entry: string, root: string): string {
  const normalized = entry.replaceAll('\\', '/')
  if (normalized.endsWith('/src/main.ts')) return 'src'
  if (normalized.includes('/src/')) return entry.slice(0, entry.indexOf('/src/') + 4)
  return root
}
