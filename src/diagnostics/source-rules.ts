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
  return {
    config,
    file,
    text,
    sourceFile: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  }
}

function runCoreSourceDiagnostics({
  file,
  text,
  sourceFile,
}: SourceDiagnosticContext): Diagnostic[] {
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
  if (hasNonLiteralDynamicImport(sourceFile)) {
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
