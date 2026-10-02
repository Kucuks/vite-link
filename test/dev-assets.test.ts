import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { startDevSession, type DevSession } from '../src/cli/commands/dev'
import { createFixture } from './helpers'

it('preserves a watched build source map when an asset is added and removed', async () => {
  const root = await createFixture()
  const configPath = join(root, 'vite.config.ts')
  const pluginUrl = pathToFileURL(resolve('src/plugin.ts')).href
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let session: DevSession | undefined
  try {
    await mkdir(join(root, 'public'))
    await writeFile(join(root, 'src/main.ts'), 'setInterval(() => {}, 1000)\n')
    await writeFile(
      configPath,
      [
        `import viteLink from ${JSON.stringify(pluginUrl)}`,
        'export default { plugins: [viteLink({',
        'clearScreen: false, diagnostics: false, typecheck: false, metadata: false,',
        'build: { sourcemap: true },',
        "assets: [{ include: 'public/*.map', base: 'public' }],",
        '})] }',
      ].join('\n'),
    )
    session = await startDevSession({ root, config: configPath })
    await session.ready
    const outputPath = join(root, 'dist/main.cjs.map')
    const output = await readFile(outputPath, 'utf8')
    expect(JSON.parse(output).version).toBe(3)
    const assetPath = join(root, 'public/main.cjs.map')
    const collisionCount = () =>
      errorSpy.mock.calls.filter((args) => String(args[0]).includes('Asset target collision'))
        .length
    await writeFile(assetPath, 'asset collision')
    await vi.waitFor(() => expect(collisionCount()).toBeGreaterThan(0), { timeout: 5000 })
    expect(await readFile(outputPath, 'utf8')).toBe(output)
    const addedCollisions = collisionCount()
    await rm(assetPath)
    await vi.waitFor(() => expect(collisionCount()).toBeGreaterThan(addedCollisions), {
      timeout: 5000,
    })
    await session.close()
    session = undefined
    expect(await readFile(outputPath, 'utf8')).toBe(output)
  } finally {
    await session?.close()
    errorSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
