import type { BuildOptions } from '../../types'
import { getPackageType } from '../../core/package'
import { getCompilerOptions } from '../../core/tsconfig'

export function normalizeBuild(
  build: BuildOptions | undefined,
  tsconfig: Record<string, unknown>,
  packageJson: Record<string, unknown>,
): Required<BuildOptions> {
  const format = detectFormat(build?.format ?? 'auto', tsconfig, packageJson)
  const extension = format === 'esm' ? 'mjs' : 'cjs'
  return {
    outDir: build?.outDir ?? 'dist',
    emptyOutDir: build?.emptyOutDir ?? true,
    sourcemap: build?.sourcemap ?? true,
    minify: build?.minify ?? false,
    target: build?.target ?? 'node20',
    format,
    entryFileName: build?.entryFileName ?? `main.${extension}`,
    chunkFileNames: build?.chunkFileNames ?? `chunks/[name]-[hash].${extension}`,
    preserveModules: build?.preserveModules ?? false,
  }
}

function detectFormat(
  requested: BuildOptions['format'],
  tsconfig: Record<string, unknown>,
  packageJson: Record<string, unknown>,
): 'esm' | 'cjs' {
  if (requested === 'esm' || requested === 'cjs') return requested

  const module = String(getCompilerOptions(tsconfig).module ?? '').toLowerCase()
  if (module.includes('commonjs')) return 'cjs'
  if (getPackageType(packageJson) === 'module') return 'esm'
  if (module.includes('nodenext') || module.includes('node16')) return 'cjs'
  return 'cjs'
}
