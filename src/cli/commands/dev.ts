import { build as viteBuild } from 'vite'
import { copyAssets, watchAssets } from '../../assets'
import { clearConsole } from '../../core/console'
import { reportDiagnostics, runDiagnostics, shouldFailDiagnostics } from '../../diagnostics'
import { startMetadataWatcher } from '../../metadata'
import { ChildRunner, RestartController, bindProcessShutdown } from '../../process'
import { runTypecheck, startTypecheckWatcher } from '../../typecheck'
import { createCliContext, type CliGlobalOptions } from '../context'

export async function devCommand(options: CliGlobalOptions): Promise<void> {
  const session = await startDevSession(options)
  bindProcessShutdown(session.close)
}

export interface DevSession {
  ready: Promise<void>
  close(): Promise<void>
}

export async function startDevSession(options: CliGlobalOptions): Promise<DevSession> {
  const { config, viteConfig } = await createCliContext(options, 'serve')

  clearConsole(config.clearScreen)

  if (config.dev.strategy !== 'restart') {
    throw new Error(`Unsupported dev strategy: ${config.dev.strategy}`)
  }

  const diagnostics = await runDiagnostics(config)
  reportDiagnostics(diagnostics)
  if (
    shouldFailDiagnostics(diagnostics, {
      strict: options.strict ?? false,
      failOn: config.diagnostics.failOn,
    })
  ) {
    throw new Error('Diagnostics failed')
  }

  if (config.typecheck.dev === 'before') {
    await runTypecheck(config)
  }

  await copyAssets(config)
  const runner = new ChildRunner(config)
  const restarter = new RestartController(config.dev.debounce, async () => runner.restart())
  const previousCliCommand = process.env.VITE_LINK_CLI_COMMAND
  let typecheck: ReturnType<typeof startTypecheckWatcher>
  let metadataWatcher: ReturnType<typeof startMetadataWatcher>
  let assetWatcher: ReturnType<typeof watchAssets>
  let watcher: ViteWatcher | undefined
  let cliCommandChanged = false
  let closed = false

  const close = async () => {
    if (closed) return
    closed = true
    restarter.close()

    const cleanupErrors: unknown[] = []
    try {
      typecheck?.kill('SIGTERM')
    } catch (error) {
      cleanupErrors.push(error)
    }

    const results = await Promise.allSettled([
      metadataWatcher?.close(),
      assetWatcher?.close(),
      watcher?.close(),
      runner.stop(),
    ])
    cleanupErrors.push(
      ...results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason),
    )

    if (cliCommandChanged) {
      if (previousCliCommand === undefined) delete process.env.VITE_LINK_CLI_COMMAND
      else process.env.VITE_LINK_CLI_COMMAND = previousCliCommand
      cliCommandChanged = false
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to close the Vite Link development session')
    }
  }

  try {
    typecheck = startTypecheckWatcher(config)
    metadataWatcher = startMetadataWatcher(config)
    assetWatcher = watchAssets(config, async () => restarter.schedule())
    process.env.VITE_LINK_CLI_COMMAND = 'dev'
    cliCommandChanged = true

    const buildResult = await viteBuild({
      ...viteConfig,
      build: {
        ...viteConfig.build,
        watch: {},
      },
    })

    if (!isRolldownWatcher(buildResult)) {
      throw new Error('Vite did not return a Rolldown watcher in dev mode')
    }
    watcher = buildResult
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Failed to start and clean up the Vite Link development session',
        { cause: cleanupError },
      )
    }
    throw error
  }

  let firstBuild = true
  let resolveReady!: () => void
  const ready = new Promise<void>((resolvePromise) => {
    resolveReady = resolvePromise
  })

  watcher.on('event', (event) => {
    if (closed) return
    if (event.code === 'ERROR') {
      console.error(event.error)
      return
    }

    if (event.code === 'BUNDLE_END') {
      clearConsole(config.clearScreen)

      if (firstBuild) {
        firstBuild = false
        runner.start()
        resolveReady()
      } else {
        restarter.schedule()
      }
    }
  })

  return {
    ready,
    close,
  }
}

interface ViteWatcher {
  on: (event: 'event', cb: (event: { code: string; error?: unknown }) => void) => void
  close: () => Promise<void>
}

function isRolldownWatcher(value: unknown): value is ViteWatcher {
  return value !== null && typeof value === 'object' && 'on' in value && 'close' in value
}
