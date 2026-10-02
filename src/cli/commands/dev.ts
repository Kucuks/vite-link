import { resolve } from 'node:path'
import { build as viteBuild } from 'vite'
import { collectEmittedOutputPaths, copyAssets, watchAssets } from '../../assets'
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
  /** Resolves after the first successful build has spawned the application process. */
  ready: Promise<void>
  /** Resolves when the first application reports successful startup via runManagedBootstrap. */
  applicationReady: Promise<void>
  close(): Promise<void>
}

export async function startDevSession(options: CliGlobalOptions): Promise<DevSession> {
  const { config, viteConfig } = await createCliContext(options, 'serve')

  clearConsole(config.clearScreen)

  if (config.dev.strategy !== 'restart') {
    throw new Error(`Unsupported dev strategy: ${config.dev.strategy}`)
  }

  const diagnostics = await runDiagnostics(config, viteConfig)
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

  const protectedOutputs = new Set([
    resolve(config.root, config.build.outDir, config.build.entryFileName),
  ])
  await copyAssets(config, protectedOutputs)
  const runner = new ChildRunner(config)
  const restarter = new RestartController(config.dev.debounce, async () => runner.restart())
  const previousCliCommand = process.env.VITE_LINK_CLI_COMMAND
  const previousNodeEnv = process.env.NODE_ENV
  let typecheck: ReturnType<typeof startTypecheckWatcher>
  let metadataWatcher: ReturnType<typeof startMetadataWatcher>
  let assetWatcher: ReturnType<typeof watchAssets>
  let watcher: ViteWatcher | undefined
  let cliCommandChanged = false
  let nodeEnvChanged = false
  let closed = false
  let closing: Promise<void> | undefined
  let settleReady: ((error?: Error) => void) | undefined
  let settleApplicationReady: ((error?: Error) => void) | undefined

  const close = (): Promise<void> => {
    if (closing) return closing
    closed = true
    const closeError = new Error('The Vite Link development session closed before startup')
    settleReady?.(closeError)
    settleApplicationReady?.(closeError)
    const restarterClose = restarter.close()
    const runnerClose = runner.close()

    closing = (async () => {
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
        restarterClose,
        runnerClose,
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

      if (nodeEnvChanged) {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previousNodeEnv
        nodeEnvChanged = false
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, 'Failed to close the Vite Link development session')
      }
    })()
    return closing
  }

  try {
    typecheck = startTypecheckWatcher(config)
    metadataWatcher = startMetadataWatcher(config)
    assetWatcher = watchAssets(
      config,
      async () => restarter.schedule(),
      undefined,
      protectedOutputs,
    )
    process.env.VITE_LINK_CLI_COMMAND = 'dev'
    cliCommandChanged = true
    process.env.NODE_ENV = resolveDevNodeEnv(config.dev.env.NODE_ENV, previousNodeEnv)
    nodeEnvChanged = true

    const buildResult = await viteBuild({
      ...viteConfig,
      plugins: [
        ...(viteConfig.plugins ?? []),
        {
          name: 'vite-link-protect-dev-outputs',
          generateBundle(_options, bundle) {
            const emitted = collectEmittedOutputPaths(config, { output: Object.values(bundle) })
            for (const output of emitted) {
              protectedOutputs.add(output)
            }
          },
        },
      ],
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
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })
  let readySettled = false
  settleReady = (error?: Error) => {
    if (readySettled) return
    readySettled = true
    if (error) rejectReady(error)
    else resolveReady()
  }
  void ready.catch(() => {})

  let resolveApplicationReady!: () => void
  let rejectApplicationReady!: (error: Error) => void
  const applicationReady = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveApplicationReady = resolvePromise
    rejectApplicationReady = rejectPromise
  })
  let applicationReadySettled = false
  settleApplicationReady = (error?: Error) => {
    if (applicationReadySettled) return
    applicationReadySettled = true
    if (error) rejectApplicationReady(error)
    else resolveApplicationReady()
  }
  void applicationReady.catch(() => {})

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
        try {
          runner.start()
          settleReady?.()
          void runner.applicationReady.then(
            () => settleApplicationReady?.(),
            (error: unknown) =>
              settleApplicationReady?.(error instanceof Error ? error : new Error(String(error))),
          )
        } catch (error) {
          const startupError = error instanceof Error ? error : new Error(String(error))
          settleReady?.(startupError)
          settleApplicationReady?.(startupError)
          console.error(startupError)
        }
      } else {
        restarter.schedule()
      }
    }
  })

  return {
    ready,
    applicationReady,
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

function resolveDevNodeEnv(configured: string | undefined, inherited: string | undefined): string {
  if (configured) return configured
  if (inherited && inherited !== 'production') return inherited
  return 'development'
}
