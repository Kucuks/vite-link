#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { cac } from 'cac'
import pc from 'picocolors'
import { buildCommand } from './commands/build'
import { devCommand } from './commands/dev'
import { diagnosticsCommand } from './commands/diagnostics'
import { metadataCommand } from './commands/metadata'

const packageMetadata = readPackageMetadata()
const cli = cac(packageMetadata.name)

function withGlobalOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option('--root <path>', 'Project root')
    .option('--config <path>', 'Vite config file')
    .option('--mode <mode>', 'Vite mode')
    .option('--strict', 'Fail on configured diagnostic threshold')
}

withGlobalOptions(
  cli.command('dev', 'Start Vite build watcher and managed child-process runner'),
).action(run(devCommand))

withGlobalOptions(cli.command('build', 'Production build')).action(run(buildCommand))
withGlobalOptions(cli.command('diagnostics', 'Run Vite Link diagnostics')).action(
  run(diagnosticsCommand),
)
withGlobalOptions(cli.command('metadata', 'Run configured metadata generator commands')).action(
  run(metadataCommand),
)

cli.help()
cli.version(packageMetadata.version)
cli.parse()

function run<T extends Record<string, unknown>>(handler: (options: T) => Promise<void>) {
  return async (options: T) => {
    try {
      await handler(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(pc.red(`[${packageMetadata.name}] ${message}`))
      process.exitCode = 1
    }
  }
}

function readPackageMetadata(): { name: string; version: string } {
  try {
    const json = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as Partial<{ name: string; version: string }>
    return {
      name: json.name || 'vite-link',
      version: json.version || '0.0.0',
    }
  } catch {
    return { name: 'vite-link', version: '0.0.0' }
  }
}
