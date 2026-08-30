import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveViteKitConfig } from '../src/config/defaults'
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
        `writeFileSync(${JSON.stringify(readyFile)}, "ready")`,
        'process.on("message", (message) => {',
        '  if (message?.type !== "vite-kit:shutdown-request") return',
        `  writeFileSync(${JSON.stringify(closedFile)}, "closed")`,
        '  process.disconnect()',
        '})',
        'process.send({ type: "vite-kit:runtime-ready" })',
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )

    const config = await resolveViteKitConfig({
      root,
      dev: { gracefulTimeout: 500, nodeArgs: [] },
      build: { entryFileName: 'main.cjs' },
    })
    const runner = new ChildRunner(config)

    runner.start()
    await waitForFile(readyFile)
    await runner.stop()

    await expect(readFile(closedFile, 'utf8')).resolves.toBe('closed')
    expect(runner.currentPid).toBeUndefined()
  })

  it('loads dotenv files for the configured Vite mode', async () => {
    const root = await createFixture()
    const readyFile = join(root, 'mode-env.json')
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, '.env.development'), 'VITE_KIT_TEST_VALUE=wrong-mode')
    await writeFile(join(root, '.env.staging'), 'VITE_KIT_TEST_VALUE=staging-mode')
    await writeFile(
      join(root, 'dist/main.cjs'),
      [
        'const { writeFileSync } = require("node:fs")',
        `writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify({ value: process.env.VITE_KIT_TEST_VALUE }))`,
        'setInterval(() => {}, 1000)',
      ].join('\n'),
    )
    const config = await resolveViteKitConfig(
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

    const config = await resolveViteKitConfig({
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
