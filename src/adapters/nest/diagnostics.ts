import fg from 'fast-glob'
import { fileExists, readText } from '../../core/fs'
import { getCompilerOptions } from '../../core/tsconfig'
import type { Diagnostic, ResolvedViteKitConfig, SourceDiagnosticContext } from '../../types'
import ts from 'typescript'

export async function runNestConfigDiagnostics(
  config: ResolvedViteKitConfig,
): Promise<Diagnostic[]> {
  const diagnostics = checkNestCompilerOptions(config)
  if (!(await fileExists(config.entry))) return diagnostics

  if (config.diagnostics.strict && !(await projectUsesShutdownHooks(config))) {
    diagnostics.push({
      code: 'NEST_SHUTDOWN_HOOKS_RECOMMENDED',
      severity: 'info',
      file: config.entry,
      message: '`app.enableShutdownHooks()` was not detected.',
      hint: 'Enable shutdown hooks so child-process restarts can close DB connections, queues and sockets cleanly.',
    })
  }
  return diagnostics
}

async function projectUsesShutdownHooks(config: ResolvedViteKitConfig): Promise<boolean> {
  const files = await fg(['**/*.ts'], {
    cwd: config.sourceRoot,
    absolute: true,
    ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    followSymbolicLinks: false,
  })
  const source = await Promise.all(files.sort().map((file) => readText(file)))
  return source.some((text) => /enableShutdownHooks\s*\(/.test(text))
}

export function runNestSourceDiagnostics({
  file,
  sourceFile,
}: SourceDiagnosticContext): Diagnostic[] {
  const injectionNames = findTypeOnlyInjectionNames(sourceFile)
  if (injectionNames.length === 0) return []
  return [
    {
      code: 'NEST_TYPE_ONLY_INJECTION_RISK',
      severity: 'warn',
      file,
      message: `Constructor injection uses type-only import(s): ${injectionNames.join(', ')}.`,
      hint: 'Constructor injection tokens must exist at runtime. Use value imports or explicit `@Inject()` tokens.',
    },
  ]
}

function checkNestCompilerOptions(config: ResolvedViteKitConfig): Diagnostic[] {
  const options = getCompilerOptions(config.tsconfigRaw)
  const diagnostics: Diagnostic[] = []

  if (options.experimentalDecorators !== true) {
    diagnostics.push({
      code: 'NEST_DECORATORS_DISABLED',
      severity: 'fatal',
      file: config.tsconfig,
      message: '`experimentalDecorators` is not enabled.',
      hint: 'NestJS depends on decorators. Enable `compilerOptions.experimentalDecorators: true`.',
    })
  }
  if (options.emitDecoratorMetadata !== true) {
    diagnostics.push({
      code: 'NEST_METADATA_DISABLED',
      severity: 'fatal',
      file: config.tsconfig,
      message: '`emitDecoratorMetadata` is not enabled.',
      hint: 'Enable it or use explicit `@Inject()` tokens for every dependency.',
    })
  }
  return diagnostics
}

function findTypeOnlyInjectionNames(source: ts.SourceFile): string[] {
  const imports = collectImportNames(source)
  if (imports.typeOnly.size === 0) return []
  const names = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isConstructorDeclaration(node) && isNestInjectionClass(node.parent)) {
      for (const parameter of node.parameters) {
        if (hasInjectDecorator(parameter)) continue
        for (const name of collectTypeReferenceNames(parameter.type)) {
          if (imports.typeOnly.has(name) && !imports.value.has(name)) names.add(name)
        }
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return [...names].sort()
}

const NEST_INJECTION_DECORATORS = new Set([
  'Catch',
  'CommandHandler',
  'Controller',
  'EventsHandler',
  'Injectable',
  'Processor',
  'QueryHandler',
  'Resolver',
  'WebSocketGateway',
])

function isNestInjectionClass(node: ts.Node): node is ts.ClassDeclaration | ts.ClassExpression {
  if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) return false
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined
  return Boolean(
    decorators?.some((decorator) => {
      const expression = ts.isCallExpression(decorator.expression)
        ? decorator.expression.expression
        : decorator.expression
      const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : undefined
      return name ? NEST_INJECTION_DECORATORS.has(name) : false
    }),
  )
}

function collectImportNames(source: ts.SourceFile): { typeOnly: Set<string>; value: Set<string> } {
  const typeOnly = new Set<string>()
  const value = new Set<string>()
  const add = (name: string, isTypeOnly: boolean) => (isTypeOnly ? typeOnly : value).add(name)

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const clause = statement.importClause
    if (clause.name) add(clause.name.text, clause.isTypeOnly)
    const bindings = clause.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) {
      add(bindings.name.text, clause.isTypeOnly)
      continue
    }
    for (const specifier of bindings.elements) {
      add(specifier.name.text, clause.isTypeOnly || specifier.isTypeOnly)
    }
  }
  return { typeOnly, value }
}

function collectTypeReferenceNames(type: ts.TypeNode | undefined): string[] {
  if (!type) return []
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const name = getEntityNameRoot(node.typeName)
      if (name) names.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(type)
  return [...names]
}

function getEntityNameRoot(name: ts.EntityName): string | undefined {
  return ts.isIdentifier(name) ? name.text : getEntityNameRoot(name.left)
}

function hasInjectDecorator(parameter: ts.ParameterDeclaration): boolean {
  const decorators = ts.canHaveDecorators(parameter) ? ts.getDecorators(parameter) : undefined
  return Boolean(decorators?.some((decorator) => isInjectDecoratorExpression(decorator.expression)))
}

function isInjectDecoratorExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text.startsWith('Inject')
  if (ts.isCallExpression(expression)) return isInjectDecoratorExpression(expression.expression)
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text.startsWith('Inject')
  return false
}
