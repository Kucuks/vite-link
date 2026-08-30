import { createCliContext, type CliGlobalOptions } from '../context'
import { reportDiagnostics, runDiagnostics, shouldFailDiagnostics } from '../../diagnostics'

export async function diagnosticsCommand(options: CliGlobalOptions): Promise<void> {
  const { config } = await createCliContext(options, 'build')
  const diagnostics = await runDiagnostics(config)
  reportDiagnostics(diagnostics)

  if (
    shouldFailDiagnostics(diagnostics, {
      strict: options.strict ?? config.diagnostics.strict,
      failOn: config.diagnostics.failOn,
    })
  ) {
    process.exitCode = 1
  }
}
