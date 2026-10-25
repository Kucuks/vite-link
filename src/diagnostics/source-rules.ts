import fg from 'fast-glob'
import ts from 'typescript'
import { mapConcurrent } from '../core/concurrency'
import { readText } from '../core/fs'
import type { Diagnostic, ResolvedViteLinkConfig, SourceDiagnosticContext } from '../types'

export async function runSourceDiagnostics(config: ResolvedViteLinkConfig): Promise<Diagnostic[]> {
  const files = await fg(['**/*.ts'], {
    cwd: config.sourceRoot,
    absolute: true,
    ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    followSymbolicLinks: false,
  })

  const results = await mapConcurrent(files.sort(), DIAGNOSTIC_READ_CONCURRENCY, async (file) => {
    const context = await createSourceDiagnosticContext(config, file)
    const adapterResults = await Promise.all(
      config.adapters.map(async (adapter) => adapter.sourceDiagnostics?.(context) ?? []),
    )
    return [...runCoreSourceDiagnostics(context), ...adapterResults.flat()]
  })
  return results.flat()
}

async function createSourceDiagnosticContext(
  config: ResolvedViteLinkConfig,
  file: string,
): Promise<SourceDiagnosticContext> {
  const text = await readText(file)
  let sourceFile: ts.SourceFile | undefined
  return {
    config,
    file,
    text,
    get sourceFile() {
      return (sourceFile ??= ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))
    },
    set sourceFile(value: ts.SourceFile) {
      sourceFile = value
    },
  }
}

function runCoreSourceDiagnostics(context: SourceDiagnosticContext): Diagnostic[] {
  const { file, text } = context
  const diagnostics: Diagnostic[] = []

  if (/entities\s*:\s*\[[^\]]*\*\*\/\*\.entity/.test(text)) {
    diagnostics.push({
      code: 'ORM_ENTITY_GLOB',
      severity: 'error',
      file,
      message: 'ORM entity glob pattern detected.',
      hint: 'Bundled output may not contain physical entity files. Prefer explicit entity class references or a manifest strategy.',
    })
  }
  if (/migrations\s*:\s*\[[^\]]*\*\*/.test(text)) {
    diagnostics.push({
      code: 'ORM_MIGRATION_GLOB',
      severity: 'warn',
      file,
      message: 'Migration glob pattern detected.',
      hint: 'Copy migrations as assets or build migrations separately.',
    })
  }
  if (mayHaveDynamicImport(text) && hasNonLiteralDynamicImport(context.sourceFile)) {
    diagnostics.push({
      code: 'DYNAMIC_IMPORT_NON_LITERAL',
      severity: 'warn',
      file,
      message: 'Dynamic import with non-literal specifier detected.',
      hint: 'Bundlers cannot discover arbitrary runtime module paths. Use explicit imports or a manifest.',
    })
  }

  return diagnostics
}

function mayHaveDynamicImport(text: string): boolean {
  if (!text.includes('import') && !text.includes('\\')) return false
  // Comments can separate the keyword and `(`; escapes can spell the keyword.
  // Let the parser handle those cases, including imports inside template expressions.
  return (
    /\bimport\s*\(/.test(text) || text.includes('/*') || text.includes('//') || text.includes('\\')
  )
}

function hasNonLiteralDynamicImport(source: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      found = !specifier || !ts.isStringLiteralLike(specifier)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const DIAGNOSTIC_READ_CONCURRENCY = 16
