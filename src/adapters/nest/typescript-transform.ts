import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import type { Plugin } from 'vite'
import { resolveViteLinkConfig } from '../../config/defaults'
import { toPosixPath } from '../../core/fs'
import { getCompilerOptions } from '../../core/tsconfig'
import type { ResolvedViteLinkConfig, ViteLinkOptions } from '../../types'

const TS_FILE_RE = /\.(?:[cm]?ts)$/
const REFLECT_METADATA_RE =
  /(?:import\s+['"]reflect-metadata['"]|from\s+['"]reflect-metadata['"]|require\(['"]reflect-metadata['"]\))/

export function createNestTypeScriptTransformPlugin(
  options: ViteLinkOptions | ResolvedViteLinkConfig,
): Plugin {
  let resolved = isResolvedConfig(options) ? Promise.resolve(options) : undefined
  let compilerOptions: ts.CompilerOptions | undefined
  let entryId: string | undefined

  const prepare = async (viteRoot?: string, viteMode?: string) => {
    const root = options.root ?? viteRoot
    resolved ??= resolveViteLinkConfig(
      {
        ...options,
        ...(root ? { root } : {}),
      },
      'production',
      viteMode ?? 'production',
    )
    const config = await resolved
    compilerOptions ??= createCompilerOptions(config)
    entryId ??= normalizeId(config.entry)
  }

  return {
    name: 'vite-link:nest-typescript-decorators',
    enforce: 'pre',

    async configResolved(config) {
      await prepare(config.root, config.mode)
    },

    async transform(code, id) {
      const cleanId = id.split('?')[0]
      if (!cleanId || !TS_FILE_RE.test(cleanId)) return null
      if (cleanId.endsWith('.d.ts')) return null
      if (cleanId.includes('/node_modules/') || cleanId.includes('\\node_modules\\')) return null

      await prepare()
      if (normalizeId(cleanId) !== entryId && !hasDecoratorToken(code)) return null
      const result = ts.transpileModule(code, {
        fileName: cleanId,
        compilerOptions: compilerOptions!,
        reportDiagnostics: false,
      })

      return {
        code: maybePrependReflectMetadata(result.outputText, code, cleanId, entryId!),
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
      }
    },
  }
}

function hasDecoratorToken(code: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code)
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    if (scanner.getToken() === ts.SyntaxKind.AtToken) return true
  }
  return false
}

function isResolvedConfig(
  value: ViteLinkOptions | ResolvedViteLinkConfig,
): value is ResolvedViteLinkConfig {
  return 'originalOptions' in value && 'packageJson' in value
}

function createCompilerOptions(config: ResolvedViteLinkConfig): ts.CompilerOptions {
  const rawOptions = getCompilerOptions(config.tsconfigRaw)
  const converted = ts.convertCompilerOptionsFromJson(
    rawOptions,
    dirname(config.tsconfig),
    config.tsconfig,
  )

  return {
    ...converted.options,
    module: ts.ModuleKind.ESNext,
    sourceMap: true,
    inlineSources: true,
    noEmitHelpers: false,
    importHelpers: false,
    isolatedModules: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: rawOptions.emitDecoratorMetadata === true,
  }
}

function maybePrependReflectMetadata(
  output: string,
  input: string,
  id: string,
  entryId: string,
): string {
  if (normalizeId(id) !== entryId) return output
  if (hasReflectMetadataBeforeNest(input) || hasReflectMetadataBeforeNest(output)) return output
  return `import 'reflect-metadata';\n${output}`
}

function normalizeId(id: string): string {
  return toPosixPath(resolve(id)).replace(/^\/([A-Za-z]:\/)/, '$1')
}

function hasReflectMetadataBeforeNest(code: string): boolean {
  const reflectIndex = code.search(REFLECT_METADATA_RE)
  if (reflectIndex === -1) return false
  const nestIndex = code.search(/from\s+['"]@nestjs\//)
  return nestIndex === -1 || reflectIndex < nestIndex
}
