import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCompilerOptions, readTsconfig } from '../src/core/tsconfig'
import { createFixture } from './helpers'

describe('tsconfig reader', () => {
  it('merges multiple extends entries in declaration order', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'tsconfig.base-a.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2021', strict: false } }),
    )
    await writeFile(
      join(root, 'tsconfig.base-b.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', noUncheckedIndexedAccess: true } }),
    )
    await writeFile(
      join(root, 'tsconfig.build.json'),
      JSON.stringify({
        extends: ['./tsconfig.base-a.json', './tsconfig.base-b.json'],
        compilerOptions: { strict: true },
      }),
    )

    const result = await readTsconfig(join(root, 'tsconfig.build.json'))
    expect(getCompilerOptions(result.json)).toMatchObject({
      target: 'ES2022',
      strict: true,
      noUncheckedIndexedAccess: true,
    })
  })

  it('fails unresolved and circular extends chains', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'missing.json'), JSON.stringify({ extends: './not-found.json' }))
    await expect(readTsconfig(join(root, 'missing.json'))).rejects.toThrow(/Failed to resolve/)

    await writeFile(join(root, 'a.json'), JSON.stringify({ extends: './b.json' }))
    await writeFile(join(root, 'b.json'), JSON.stringify({ extends: './a.json' }))
    await expect(readTsconfig(join(root, 'a.json'))).rejects.toThrow(/Circular tsconfig/)
  })

  it('supports JSONC, trailing commas and package-based extends', async () => {
    const root = await createFixture()
    const packageRoot = join(root, 'node_modules/@tsconfig/node20')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      join(packageRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext' } }, null, 2),
    )
    await writeFile(
      join(root, 'tsconfig.build.json'),
      [
        '{',
        '  // package preset',
        '  "extends": "@tsconfig/node20/tsconfig.json",',
        '  "compilerOptions": {',
        '    "experimentalDecorators": true,',
        '    "emitDecoratorMetadata": true,',
        '    "isolatedModules": true,',
        '  },',
        '}',
      ].join('\n'),
    )

    const result = await readTsconfig(join(root, 'tsconfig.build.json'))
    const compilerOptions = getCompilerOptions(result.json)

    expect(compilerOptions.target).toBe('ES2022')
    expect(compilerOptions.module).toBe('NodeNext')
    expect(compilerOptions.emitDecoratorMetadata).toBe(true)
  })
})
