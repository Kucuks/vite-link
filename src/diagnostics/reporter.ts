import pc from 'picocolors'
import type { Diagnostic, DiagnosticSeverity } from '../types'

const ORDER: Record<DiagnosticSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  fatal: 3,
}

export function reportDiagnostics(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    console.log(pc.green('[vite-kit] diagnostics clean'))
    return
  }

  console.log(pc.bold('\nVite Kit Diagnostics\n'))

  for (const diagnostic of diagnostics) {
    const label = colorSeverity(diagnostic.severity, diagnostic.severity.toUpperCase())
    console.log(`${label} ${pc.bold(diagnostic.code)} ${diagnostic.message}`)
    if (diagnostic.file) console.log(`  ${pc.dim(diagnostic.file)}`)
    if (diagnostic.hint) console.log(`  ${pc.dim(`hint: ${diagnostic.hint}`)}`)
  }

  console.log('')
}

export function shouldFailDiagnostics(
  diagnostics: Diagnostic[],
  options: { strict: boolean; failOn: DiagnosticSeverity },
): boolean {
  if (!options.strict) return diagnostics.some((item) => item.severity === 'fatal')
  const threshold = ORDER[options.failOn]
  return diagnostics.some((item) => ORDER[item.severity] >= threshold)
}

function colorSeverity(severity: DiagnosticSeverity, text: string): string {
  if (severity === 'fatal') return pc.bgRed(pc.white(` ${text} `))
  if (severity === 'error') return pc.red(text)
  if (severity === 'warn') return pc.yellow(text)
  return pc.cyan(text)
}
