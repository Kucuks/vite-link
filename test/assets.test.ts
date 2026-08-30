import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyAssets, copyChangedAsset, findMatchingAssetPattern, watchAssets } from '../src/assets'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { createFixture } from './helpers'

describe('asset pipeline', () => {
  it('copies configured assets preserving relative paths', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/schema'), { recursive: true })
    await writeFile(join(root, 'src/schema/app.graphql'), 'type Query { ok: Boolean }')

    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['src/**/*.graphql'], base: 'src', restart: true }],
    })

    const result = await copyAssets(config)
    const copied = await readFile(join(root, 'dist/schema/app.graphql'), 'utf8')

    expect(result.copied).toBe(1)
    expect(copied).toContain('type Query')
  })

  it('rejects two asset sources that map to the same output target', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/first'), { recursive: true })
    await mkdir(join(root, 'src/second'), { recursive: true })
    await writeFile(join(root, 'src/first/shared.txt'), 'first')
    await writeFile(join(root, 'src/second/shared.txt'), 'second')
    const config = await resolveViteLinkConfig({
      root,
      assets: [
        { include: 'src/first/*.txt', base: 'src/first', outDir: 'dist' },
        { include: 'src/second/*.txt', base: 'src/second', outDir: 'dist' },
      ],
    })

    await expect(copyAssets(config)).rejects.toThrow(/Asset target collision/)
  })

  it('removes copied asset targets when the source file is deleted', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/schema'), { recursive: true })
    const source = join(root, 'src/schema/app.graphql')
    const target = join(root, 'dist/schema/app.graphql')
    await writeFile(source, 'type Query { ok: Boolean }')

    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['src/**/*.graphql'], base: 'src', restart: true }],
    })

    await copyAssets(config)
    await rm(source)

    const result = await copyChangedAsset(config, 'src/schema/app.graphql')

    await expect(readFile(target, 'utf8')).rejects.toThrow()
    expect(result.removed).toBe(true)
    expect(result.restart).toBe(true)
  })

  it('matches changed assets by path pattern without requiring the file to exist', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({
      root,
      assets: [
        { include: ['src/**/*.graphql'], exclude: ['src/**/__generated__/**'], restart: true },
      ],
    })

    expect(findMatchingAssetPattern(config, join(root, 'src/schema/app.graphql'))).toBeDefined()
    expect(
      findMatchingAssetPattern(config, join(root, 'src/schema/__generated__/app.graphql')),
    ).toBeUndefined()
  })

  it('uses full glob semantics consistently for initial and watched asset matching', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/schema'), { recursive: true })
    await writeFile(join(root, 'src/schema/schema-a.graphql'), 'a')
    await writeFile(join(root, 'src/schema/schema-c.graphql'), 'c')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['src/**/schema-[ab].@(graphql|gql)'], base: 'src' }],
    })

    const result = await copyAssets(config)
    expect(result.copied).toBe(1)
    expect(findMatchingAssetPattern(config, join(root, 'src/schema/schema-b.gql'))).toBeDefined()
    expect(
      findMatchingAssetPattern(config, join(root, 'src/schema/schema-c.graphql')),
    ).toBeUndefined()
  })

  it('rejects asset mappings that escape their configured base', async () => {
    const root = await createFixture()
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'outside')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['outside.txt'], base: 'src', outDir: 'dist' }],
    })

    await expect(copyAssets(config)).rejects.toThrow(/outside its configured base/)
  })

  it.runIf(process.platform !== 'win32')(
    'rejects symlinked assets outside the project root',
    async () => {
      const root = await createFixture()
      const externalRoot = await createFixture()
      const external = join(externalRoot, 'secret.txt')
      const linked = join(root, 'src/linked.txt')
      await writeFile(external, 'secret')
      await symlink(external, linked)
      const config = await resolveViteLinkConfig({
        root,
        assets: [{ include: ['src/linked.txt'], base: 'src', outDir: 'dist' }],
      })

      await expect(copyChangedAsset(config, linked)).rejects.toThrow(/outside the project root/)
    },
  )

  it.runIf(process.platform !== 'win32')(
    'rejects asset targets that traverse an output-directory symlink',
    async () => {
      const root = await createFixture()
      const externalRoot = await createFixture()
      await mkdir(join(root, 'src/linked'), { recursive: true })
      await mkdir(join(root, 'dist'), { recursive: true })
      await writeFile(join(root, 'src/linked/public.txt'), 'public')
      await symlink(externalRoot, join(root, 'dist/linked'))
      const config = await resolveViteLinkConfig({
        root,
        assets: [{ include: ['src/**/*.txt'], base: 'src', outDir: 'dist' }],
      })

      await expect(copyAssets(config)).rejects.toThrow(/outside its output directory/)
    },
  )

  it('rejects asset watch roots outside the project root', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['../outside/**/*.txt'], base: '..', outDir: 'dist' }],
    })

    expect(() => watchAssets(config, () => {})).toThrow(/outside the project root/)
  })

  it('watches glob-based asset patterns with Chokidar 4', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/schema'), { recursive: true })
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: ['src/**/*.graphql'], base: 'src', restart: true }],
    })
    const watcher = watchAssets(config, () => {})
    if (!watcher) throw new Error('Expected an asset watcher')

    try {
      await watcher.ready
      await writeFile(join(root, 'src/schema/live.graphql'), 'type Query { live: Boolean }')
      await waitForText(join(root, 'dist/schema/live.graphql'), 'live')
    } finally {
      await watcher.close()
    }
  })
})

async function waitForText(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, 'utf8')).includes(expected)) return
    } catch {
      // Wait for the watcher to copy the file.
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${path}`)
}
