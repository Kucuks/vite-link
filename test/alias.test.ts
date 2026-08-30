import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
})
