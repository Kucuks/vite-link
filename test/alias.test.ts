import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { createViteInlineConfig } from '../src/config/vite'
import { createTsconfigPathResolverPlugin } from '../src/core/alias'
import { toPosixPath } from '../src/core/fs'
import { readTsconfig } from '../src/core/tsconfig'
import { createFixture } from './helpers'

describe('module canonicalizer', () => {
  it('dedupes tsconfig path aliases and relative directory imports to the same file id', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'src/handler'), { recursive: true })
    await writeFile(join(root, 'src/handler/index.ts'), 'export class Handler {}')
    await writeFile(join(root, 'src/util.ts'), 'export const util = true')
    await writeFile(join(root, 'src/worker.mts'), 'export const worker = true')
    await writeFile(join(root, 'src/redis.service.ts'), 'export class RedisService {}')
    await writeFile(
      join(root, 'tsconfig.build.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            paths: {
              'src/*': ['./missing/*', './src/*'],
            },
          },
        },
        null,
        2,
      ),
    )

    const tsconfigPath = join(root, 'tsconfig.build.json')
    const tsconfig = await readTsconfig(tsconfigPath)
    const plugin = createTsconfigPathResolverPlugin(tsconfig.json, tsconfig.path)
    const resolveId = plugin.resolveId
    if (typeof resolveId !== 'function') throw new Error('Expected function resolveId hook')
    const context = {} as never
    const options = { isEntry: false }

    const importer = join(root, 'src/modules/chat/board/board.service.ts')
    const expected = toPosixPath(await realpath(join(root, 'src/handler/index.ts')))
    const expectedJsCounterpart = toPosixPath(await realpath(join(root, 'src/util.ts')))
    const expectedMjsCounterpart = toPosixPath(await realpath(join(root, 'src/worker.mts')))
    const expectedDottedBasename = toPosixPath(await realpath(join(root, 'src/redis.service.ts')))

    expect(resolveId.call(context, 'src/handler', importer, options)).toBe(expected)
    expect(resolveId.call(context, '../../../handler', importer, options)).toBe(expected)
    expect(resolveId.call(context, '../../../handler/index', importer, options)).toBe(expected)
    expect(resolveId.call(context, '../../../util.js', importer, options)).toBe(
      expectedJsCounterpart,
    )
    expect(resolveId.call(context, '../../../worker.mjs', importer, options)).toBe(
      expectedMjsCounterpart,
    )
    expect(resolveId.call(context, 'src/redis.service', importer, options)).toBe(
      expectedDottedBasename,
    )
    expect(resolveId.call(context, '../../../redis.service', importer, options)).toBe(
      expectedDottedBasename,
    )
    expect(resolveId.call(context, '@nestjs/core', importer, options)).toBeNull()
  })

  it('does not cache missing modules across watch rebuilds', async () => {
    const root = await createFixture()
    const tsconfigPath = join(root, 'tsconfig.build.json')
    const tsconfig = await readTsconfig(tsconfigPath)
    const plugin = createTsconfigPathResolverPlugin(tsconfig.json, tsconfig.path)
    const resolveId = plugin.resolveId
    if (typeof resolveId !== 'function') throw new Error('Expected function resolveId hook')

    const importer = join(root, 'src/main.ts')
    const context = {} as never
    const options = { isEntry: false }
    expect(resolveId.call(context, './created-later', importer, options)).toBeNull()

    const created = join(root, 'src/created-later.ts')
    await writeFile(created, 'export const ready = true')
    expect(resolveId.call(context, './created-later', importer, options)).toBe(
      toPosixPath(await realpath(created)),
    )
  })

  it('keeps alias and relative imports of one physical source as one build module', async () => {
    const root = await createFixture()
    const source = join(root, 'src/core/database/lafops/lafops-tenant-repository.ts')
    await mkdir(join(root, 'src/core/database/lafops'), { recursive: true })
    await writeFile(source, 'export const repository = {}\n')
    await writeFile(
      join(root, 'src/main.ts'),
      [
        "import { repository as relative } from './core/database/lafops/lafops-tenant-repository'",
        "import { repository as aliased } from 'src/core/database/lafops/lafops-tenant-repository'",
        'export const sameRepository = relative === aliased',
      ].join('\n'),
    )

    const tsconfigPath = join(root, 'tsconfig.build.json')
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8')) as {
      compilerOptions: { paths: Record<string, string[]> }
    }
    tsconfig.compilerOptions.paths['src/*'] = ['./src/*']
    await writeFile(tsconfigPath, JSON.stringify(tsconfig))

    const config = await resolveViteLinkConfig({
      root,
      diagnostics: false,
      typecheck: false,
      build: { format: 'esm' },
    })
    const viteConfig = createViteInlineConfig(config)
    const moduleIds: string[] = []
    const graphObserver = {
      name: 'test:physical-module-identity',
      generateBundle() {
        moduleIds.push(...this.getModuleIds())
      },
    } satisfies Plugin

    await build({
      ...viteConfig,
      configFile: false,
      logLevel: 'silent',
      plugins: [...(viteConfig.plugins ?? []), graphObserver],
    })

    const physicalSource = toPosixPath(realpathSync.native(source))
    const physicalModuleIds = moduleIds.filter((id) => {
      const file = id.split('?')[0]?.replace(/^\/([A-Za-z]:\/)/, '$1')
      if (!file) return false
      try {
        return toPosixPath(realpathSync.native(file)) === physicalSource
      } catch {
        return false
      }
    })
    expect(physicalModuleIds).toHaveLength(1)

    const output = await import(pathToFileURL(join(root, 'dist/main.mjs')).href)
    expect(output.sameRepository).toBe(true)
  })
})
