import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDevSession, type DevSession } from '../src/cli/commands/dev'
import { createFixture } from './helpers'

describe('managed development session', () => {
  let session: DevSession | undefined

  afterEach(async () => {
    await session?.close()
    session = undefined
  })

  it('builds, starts, serves, rebuilds and restarts after a source change', async () => {
    const root = await createFixture()
    const port = 32_000 + Math.floor(Math.random() * 2_000)
    const pluginUrl = pathToFileURL(resolve('src/plugin.ts')).href
    const runtimeUrl = pathToFileURL(resolve('src/runtime.ts')).href
    const configPath = join(root, 'vite.config.ts')

    await writeFile(
      configPath,
      [
        `import viteLink from ${JSON.stringify(pluginUrl)}`,
        'export default {',
        '  plugins: [viteLink({',
        '    clearScreen: false,',
        '    diagnostics: false,',
        '    typecheck: false,',
        `    dev: { port: ${port}, debounce: 20, gracefulTimeout: 1000 },`,
        '  })],',
        '}',
      ].join('\n'),
    )
    await writeServerEntry(root, runtimeUrl, 'version-one')

    session = await startDevSession({ root, config: configPath })
    await session.ready
    await expectResponse(port, 'version-one')

    await writeServerEntry(root, runtimeUrl, 'version-two')
    await expectResponse(port, 'version-two')
  }, 15_000)

  it('waits for the first successful build and recovers from an initial build error', async () => {
    const root = await createFixture()
    const port = 34_000 + Math.floor(Math.random() * 2_000)
    const pluginUrl = pathToFileURL(resolve('src/plugin.ts')).href
    const runtimeUrl = pathToFileURL(resolve('src/runtime.ts')).href
    const configPath = join(root, 'vite.config.ts')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await writeFile(
      configPath,
      [
        `import viteLink from ${JSON.stringify(pluginUrl)}`,
        'export default {',
        '  plugins: [',
        '    viteLink({',
        '      clearScreen: false,',
        '      diagnostics: false,',
        '      typecheck: false,',
        `      dev: { port: ${port}, debounce: 20, gracefulTimeout: 1000 },`,
        '    }),',
        '    {',
        "      name: 'fail-while-broken',",
        '      transform(code, id) {',
        "        if (id.endsWith('/src/main.ts') && code.includes('VITE_LINK_BROKEN')) {",
        "          throw new Error('intentional initial build failure')",
        '        }',
        '      },',
        '    },',
        '  ],',
        '}',
      ].join('\n'),
    )
    await writeFile(join(root, 'src/main.ts'), "export const state = 'VITE_LINK_BROKEN'")

    try {
      session = await startDevSession({ root, config: configPath })
      const readyOutcome = session.ready.then(
        () => 'ready' as const,
        () => 'rejected' as const,
      )
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled(), { timeout: 5_000 })
      await expect(
        Promise.race([readyOutcome, wait(50).then(() => 'pending' as const)]),
      ).resolves.toBe('pending')

      await writeServerEntry(root, runtimeUrl, 'recovered')
      await session.ready
      await expectResponse(port, 'recovered')
    } finally {
      errorSpy.mockRestore()
    }
  }, 15_000)
})

async function writeServerEntry(root: string, runtimeUrl: string, version: string): Promise<void> {
  await writeFile(
    join(root, 'src/main.ts'),
    [
      "import { createServer } from 'node:http'",
      `import { runManagedBootstrap } from ${JSON.stringify(runtimeUrl)}`,
      'async function start() {',
      `  const server = createServer((_request, response) => response.end(${JSON.stringify(version)}))`,
      "  await new Promise<void>((resolvePromise) => server.listen(Number(process.env.PORT), '127.0.0.1', resolvePromise))",
      '  return { close: () => new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())) }',
      '}',
      'void runManagedBootstrap(start)',
    ].join('\n'),
  )
}

async function expectResponse(port: number, expected: string): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < 5_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`)
      const text = await response.text()
      if (response.ok && text === expected) return
      lastError = new Error(`Expected ${expected}, received ${response.status} ${text}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw lastError ?? new Error(`Timed out waiting for ${expected}`)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}
