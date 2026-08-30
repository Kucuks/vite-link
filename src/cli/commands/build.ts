import { build as viteBuild } from 'vite'
import { copyAssets } from '../../assets'
import { reportDiagnostics, runDiagnostics, shouldFailDiagnostics } from '../../diagnostics'
import { runMetadataGenerators } from '../../metadata'
import { runTypecheck } from '../../typecheck'
import { clearConsole } from '../../core/console'
import { createCliContext, type CliGlobalOptions } from '../context'
import { validateBuildOutput } from '../validate'

export async function buildCommand(options: CliGlobalOptions): Promise<void> {
  const { config, viteConfig } = await createCliContext(options, 'build')

  clearConsole(config.clearScreen)
  const diagnostics = await runDiagnostics(config)
  reportDiagnostics(diagnostics)
  if (
    shouldFailDiagnostics(diagnostics, {
      strict: options.strict ?? config.diagnostics.strict,
      failOn: config.diagnostics.failOn,
    })
  ) {
    throw new Error('Diagnostics failed')
  }

  if (config.typecheck.build !== false) {
    await runTypecheck(config)
  }

  await viteBuild(viteConfig)
  await validateBuildOutput(config)
  await runMetadataGenerators(config)
  await copyAssets(config)
}
