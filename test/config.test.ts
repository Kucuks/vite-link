import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import nest from '../src/adapters/nest'
import { createCliContext } from '../src/cli/context'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { mergeUserViteConfig, stripViteLinkPlugins } from '../src/config/load'
import { createExternalPredicate, createViteInlineConfig } from '../src/config/vite'
import { createFixture, resolveNestTestConfig as resolveNestViteConfig } from './helpers'

describe('config resolution', () => {
  it('rejects invalid lifecycle, output and adapter configuration', async () => {
    const root = await createFixture()
    await expect(
      resolveViteLinkConfig({
        root,
        dev: { port: 70_000, debounce: -1 },
        build: { entryFileName: '../outside.cjs' },
        adapters: [{ name: 'duplicate' }, { name: 'duplicate' }],
      }),
    ).rejects.toThrow(/Invalid Vite Link configuration/)
  })

  it('rejects build output directories outside the project root', async () => {
    const root = await createFixture()

    await expect(resolveViteLinkConfig({ root, build: { outDir: '../outside' } })).rejects.toThrow(
      /build\.outDir.*inside the project root/,
    )
  })

  it('rejects build output directories that escape through a symlink', async () => {
    const root = await createFixture()
    const outside = await mkdtemp(join(tmpdir(), 'vite-link-output-'))
    await symlink(
      outside,
      join(root, 'linked-dist'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    await expect(resolveViteLinkConfig({ root, build: { outDir: 'linked-dist' } })).rejects.toThrow(
      /build\.outDir.*inside the project root/,
    )
  })

  it('keeps the generic core free of Nest transforms and defaults', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({ root })
    const vite = createViteInlineConfig(config)

    expect(config.adapters).toEqual([])
    expect(config.external.alwaysExternal).not.toContain('@nestjs/core')
    expect(vite.plugins?.map((plugin) => plugin && 'name' in plugin && plugin.name)).not.toContain(
      'vite-link:nest-typescript-decorators',
    )
  })

  it('detects cjs format from tsconfig and builds output names', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })

    expect(config.build.format).toBe('cjs')
    expect(config.build.entryFileName).toBe('main.cjs')
    expect(config.tsconfigPaths).toBe(true)
  })

  it('creates vite inline config for node SSR build', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const vite = createViteInlineConfig(config)

    expect(config.clearScreen).toBe(true)
    expect(vite.clearScreen).toBe(true)
    expect(vite.appType).toBe('custom')
    expect(vite.build?.ssr).toBe(config.entry)
    expect(vite.ssr?.target).toBe('node')
    expect(vite.build).toHaveProperty('rolldownOptions')
  })

  it('allows console clearing to be disabled', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root, clearScreen: false })
    const vite = createViteInlineConfig(config)

    expect(config.clearScreen).toBe(false)
    expect(vite.clearScreen).toBe(false)
  })

  it('externalizes dependency-like ids but not relative imports', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const external = createExternalPredicate(config)

    expect(external('@nestjs/core')).toBe(true)
    expect(external('reflect-metadata')).toBe(true)
    expect(external('./app.module')).toBe(false)
  })

  it('strips Vite Link plugins from CLI-managed Vite config to avoid duplicate lifecycle work', () => {
    const other = { name: 'other-plugin' }
    const stripped = stripViteLinkPlugins({ plugins: [nest({ entry: 'src/main.ts' }), other] })

    expect(stripped.plugins).toEqual([other])
  })

  it('merges user config without re-running the Vite Link plugin side effects', () => {
    const other = { name: 'other-plugin' }
    const merged = mergeUserViteConfig(
      { build: { outDir: 'dist' } },
      {
        plugins: [nest({}), other],
        build: { outDir: 'ignored', reportCompressedSize: false },
        ssr: { optimizeDeps: { include: ['custom-runtime'] } },
      },
    )

    expect(merged.plugins).toEqual([other])
    expect(merged.build?.outDir).toBe('dist')
    expect(merged.build?.reportCompressedSize).toBe(false)
    expect(merged.ssr?.optimizeDeps).toEqual({ include: ['custom-runtime'] })
  })

  it('prevents Vite from loading the project config a second time in CLI mode', async () => {
    const root = await createFixture()
    const context = await createCliContext({ root }, 'build')
    expect(context.viteConfig.configFile).toBe(false)
  })

  it('passes the resolved CLI mode to programmatic Vite builds', async () => {
    const root = await createFixture()
    const context = await createCliContext({ root, mode: 'staging' }, 'serve')

    expect(context.config.mode).toBe('staging')
    expect(context.viteConfig.mode).toBe('staging')
  })
})
