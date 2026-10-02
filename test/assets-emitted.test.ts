import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build as viteBuild } from 'vite'
import { describe, expect, it } from 'vitest'
import { collectEmittedOutputPaths, copyAssets, copyChangedAsset } from '../src/assets'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { createViteInlineConfig } from '../src/config/vite'
import { viteLink } from '../src/plugin'
import { createFixture } from './helpers'
describe('emitted output protection', () => {
  it('protects the entry reported by a real Vite build', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'src/main.ts'), 'export const built = true')
    await mkdir(join(root, 'src/generated'), { recursive: true })
    await writeFile(join(root, 'src/generated/main.cjs'), 'asset')
    const config = await resolveViteLinkConfig({
      root,
      typecheck: false,
      diagnostics: false,
      metadata: false,
      assets: [{ include: 'src/generated/*.cjs', base: 'src/generated' }],
    })
    const buildResult = await viteBuild({
      ...createViteInlineConfig(config),
      configFile: false,
      logLevel: 'silent',
    })
    const protectedOutputs = collectEmittedOutputPaths(config, buildResult)
    const entry = join(root, 'dist/main.cjs')
    const bundle = await readFile(entry, 'utf8')

    expect(protectedOutputs.has(entry)).toBe(true)
    await expect(copyAssets(config, protectedOutputs)).rejects.toThrow(
      /Asset target collision with emitted build output/,
    )
    expect(await readFile(entry, 'utf8')).toBe(bundle)
  })

  it('rejects a source-map collision through the direct Vite plugin', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'src/main.ts'), 'export const built = true')
    await mkdir(join(root, 'src/generated'), { recursive: true })
    await writeFile(join(root, 'src/generated/main.cjs.map'), 'asset')

    await expect(
      viteBuild({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: viteLink({
          root,
          diagnostics: false,
          typecheck: false,
          metadata: false,
          build: { sourcemap: true },
          assets: [{ include: 'src/generated/*.map', base: 'src/generated' }],
        }),
      }),
    ).rejects.toThrow(/Asset target collision with emitted build output/)
    expect(await readFile(join(root, 'dist/main.cjs.map'), 'utf8')).not.toBe('asset')
  })

  it('protects assets emitted by later Vite plugins', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'src/main.ts'), 'export const built = true')
    await mkdir(join(root, 'src/generated'), { recursive: true })
    await writeFile(join(root, 'src/generated/later.txt'), 'copied asset')

    await expect(
      viteBuild({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          ...viteLink({
            root,
            diagnostics: false,
            typecheck: false,
            metadata: false,
            assets: [{ include: 'src/generated/*.txt', base: 'src/generated' }],
          }),
          {
            name: 'later-output',
            generateBundle() {
              this.emitFile({ type: 'asset', fileName: 'later.txt', source: 'emitted asset' })
            },
          },
        ],
      }),
    ).rejects.toThrow(/Asset target collision with emitted build output/)
    expect(await readFile(join(root, 'dist/later.txt'), 'utf8')).toBe('emitted asset')
  })
  it('rejects a generated entry collision before copying and preserves the bundle', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/generated'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'src/generated/main.cjs'), 'asset')
    await writeFile(join(root, 'dist/main.cjs'), 'bundle')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: 'src/generated/*.cjs', base: 'src/generated' }],
    })

    await expect(copyAssets(config)).rejects.toThrow(
      /Asset target collision with emitted build output/,
    )
    expect(await readFile(join(root, 'dist/main.cjs'), 'utf8')).toBe('bundle')
  })

  it('protects emitted chunks and source maps during watched copy and deletion', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/chunks'), { recursive: true })
    await mkdir(join(root, 'dist/chunks'), { recursive: true })
    const source = join(root, 'src/chunks/shared.cjs')
    const target = join(root, 'dist/chunks/shared.cjs')
    await writeFile(source, 'asset')
    await writeFile(target, 'chunk')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: 'src/chunks/*.cjs', base: 'src' }],
    })
    const protectedOutputs = collectEmittedOutputPaths(config, {
      output: [{ fileName: 'chunks/shared.cjs', type: 'chunk' }],
    })

    expect(protectedOutputs.has(target)).toBe(true)
    expect(protectedOutputs.has(join(root, 'dist/chunks/shared.cjs.map'))).toBe(true)
    await expect(copyChangedAsset(config, source, protectedOutputs)).rejects.toThrow(
      /Asset target collision with emitted build output/,
    )
    await rm(source)
    await expect(copyChangedAsset(config, source, protectedOutputs)).rejects.toThrow(
      /Asset target collision with emitted build output/,
    )
    expect(await readFile(target, 'utf8')).toBe('chunk')
  })

  it('does not infer separate source maps when source maps are disabled or inline', async () => {
    const root = await createFixture()
    for (const sourcemap of [false, 'inline'] as const) {
      const config = await resolveViteLinkConfig({ root, build: { sourcemap } })
      const protectedOutputs = collectEmittedOutputPaths(config, {
        output: [{ fileName: 'chunks/shared.cjs', type: 'chunk' }],
      })
      expect(protectedOutputs.has(join(root, 'dist/chunks/shared.cjs.map'))).toBe(false)
    }
  })
  it.runIf(process.platform === 'win32')('rejects a source junction outside the root', async () => {
    const root = await createFixture()
    const externalRoot = await createFixture()
    await writeFile(join(externalRoot, 'secret.txt'), 'placeholder')
    await symlink(externalRoot, join(root, 'src/external'), 'junction')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: 'src/external/*.txt', base: 'src' }],
    })

    await expect(copyChangedAsset(config, join(root, 'src/external/secret.txt'))).rejects.toThrow(
      /outside the project root/,
    )
  })

  it.runIf(process.platform === 'win32')('rejects a target junction outside the root', async () => {
    const root = await createFixture()
    const externalRoot = await createFixture()
    await mkdir(join(root, 'src/linked'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    const source = join(root, 'src/linked/public.txt')
    await writeFile(source, 'public')
    await symlink(externalRoot, join(root, 'dist/linked'), 'junction')
    const config = await resolveViteLinkConfig({
      root,
      assets: [{ include: 'src/linked/*.txt', base: 'src' }],
    })

    await expect(copyChangedAsset(config, source)).rejects.toThrow(/outside its output directory/)
  })
})
