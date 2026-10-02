import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { ChildRunner, RestartController } from '../src/process'
import { createFixture } from './helpers'

describe('ChildRunner', () => {
  it('uses the runtime IPC contract for cross-platform graceful shutdown', async () => {
    const root = await createFixture()
    const readyFile = join(root, 'ipc-ready.txt')
    const closedFile = join(root, 'ipc-closed.txt')
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(
      join(root, 'dist/main.cjs'),
      [
        'const { writeFileSync } = require("node:fs")',
        `writeFileSync(${JSON.stringify(readyFile)}, process.env.VITE_LINK_MANAGED)`,
        'process.on("message", (message) => {',
        '  if (message?.type !== "vite-link:shutdown-request") return',
        `  writeFileSync(${JSON.stringify(closedFile)}, "closed")`,
        '  process.disconnect()',
        '})',
        'process.send({ type: "vite-link:runtime-ready" })',
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )

    const config = await resolveViteLinkConfig({
      root,
      dev: { gracefulTimeout: 500, nodeArgs: [] },
      build: { entryFileName: 'main.cjs' },
    })
    const runner = new ChildRunner(config)

    runner.start()
    await runner.applicationReady
    await runner.stop()

    await expect(readFile(closedFile, 'utf8')).resolves.toBe('closed')
    await expect(readFile(readyFile, 'utf8')).resolves.toBe('1')
    expect(runner.currentPid).toBeUndefined()
  })

  it('rejects application readiness and diagnoses an early exit', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist/main.cjs'), 'process.exit(1)')
    const config = await resolveViteLinkConfig({
      root,
      dev: { port: 49152, nodeArgs: [] },
      build: { entryFileName: 'main.cjs' },
    })
    const errors: unknown[] = []
    const runner = new ChildRunner(config, (error) => errors.push(error))

    runner.start()
    await expect(runner.applicationReady).rejects.toThrow(/PORT=49152/)
    expect(errors).toHaveLength(1)
    await runner.close()
  })

  it('does not respawn after closing during an in-flight restart', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({ root })
    const runner = new ChildRunner(config)
    let releaseStop!: () => void
    const stopGate = new Promise<void>((resolvePromise) => {
      releaseStop = resolvePromise
    })
    const stopSpy = vi.spyOn(runner, 'stop').mockImplementation(async () => stopGate)
    const startSpy = vi.spyOn(runner, 'start')
    const controller = new RestartController(0, () => runner.restart())

    const restarting = controller.flush()
    await vi.waitFor(() => expect(stopSpy).toHaveBeenCalledTimes(1))
    const closingRunner = runner.close()
    let controllerClosed = false
    const closingController = controller.close().finally(() => {
      controllerClosed = true
    })
    await Promise.resolve()
    expect(controllerClosed).toBe(false)
    controller.schedule()
    releaseStop()
    await Promise.all([restarting, closingRunner, closingController])

    expect(startSpy).not.toHaveBeenCalled()
    expect(controllerClosed).toBe(true)
  })

  it('loads dotenv files for the configured Vite mode', async () => {
    const root = await createFixture()
    const readyFile = join(root, 'mode-env.json')
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, '.env.development'), 'VITE_LINK_TEST_VALUE=wrong-mode')
    await writeFile(join(root, '.env.staging'), 'VITE_LINK_TEST_VALUE=staging-mode')
    await writeFile(
      join(root, 'dist/main.cjs'),
      [
        'const { writeFileSync } = require("node:fs")',
        `writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify({ value: process.env.VITE_LINK_TEST_VALUE }))`,
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )
    const config = await resolveViteLinkConfig(
      { root, dev: { gracefulTimeout: 50, nodeArgs: [] } },
      'development',
      'staging',
    )
    const runner = new ChildRunner(config)

    runner.start()
    await waitForFile(readyFile)
    const env = JSON.parse(await readFile(readyFile, 'utf8')) as { value: string }
    await runner.stop()

    expect(env.value).toBe('staging-mode')
  })

  it('force-kills a child process that ignores SIGTERM', async () => {
    const root = await createFixture()
    const readyFile = join(root, 'ready.txt')
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(
      join(root, 'dist/main.cjs'),
      [
        'const { writeFileSync } = require("node:fs")',
        'process.on("SIGTERM", () => {})',
        `writeFileSync(${JSON.stringify(readyFile)}, "ready")`,
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )

    const config = await resolveViteLinkConfig({
      root,
      dev: { gracefulTimeout: 50, nodeArgs: [] },
      build: { entryFileName: 'main.cjs' },
    })
    const runner = new ChildRunner(config)

    runner.start()
    await waitForFile(readyFile)
    const started = Date.now()
    await runner.stop()

    expect(Date.now() - started).toBeLessThan(2000)
    expect(runner.currentPid).toBeUndefined()
  })

  it('reports scheduled restart failures without creating an unhandled rejection', async () => {
    const errors: unknown[] = []
    const controller = new RestartController(
      1,
      async () => {
        throw new Error('restart failed')
      },
      (error) => errors.push(error),
    )

    controller.schedule()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })
})

async function waitForFile(path: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 2000) {
    try {
      await readFile(path, 'utf8')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  throw new Error(`Timed out waiting for ${path}`)
}
