import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { createViteInlineConfig } from '../src/config/vite'
import { createFixture } from './helpers'

describe('dependency externalization', () => {
  it('keeps dependencies external unless noExternal explicitly selects them for bundling', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        type: 'commonjs',
        dependencies: { 'external-lib': '1.0.0', 'bundled-lib': '1.0.0' },
      }),
    )
    await createPackage(root, 'external-lib', 'external-marker')
    await createPackage(root, 'bundled-lib', 'bundled-marker')
    await writeFile(
      join(root, 'src/main.ts'),
      [
        "import externalValue from 'external-lib'",
        "import bundledValue from 'bundled-lib'",
        'console.log(externalValue, bundledValue)',
      ].join('\n'),
    )
    const config = await resolveViteLinkConfig({
      root,
      diagnostics: false,
      typecheck: false,
      external: { noExternal: ['bundled-lib'] },
    })

    await build({ ...createViteInlineConfig(config), configFile: false, logLevel: 'silent' })

    const output = await readFile(join(root, 'dist/main.cjs'), 'utf8')
    expect(output).toMatch(/require\(["']external-lib["']\)/)
    expect(output).toContain('bundled-marker')
    expect(output).not.toMatch(/require\(["']bundled-lib["']\)/)
  })
})

async function createPackage(root: string, name: string, marker: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', name)
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  await writeFile(join(packageRoot, 'index.js'), `module.exports = ${JSON.stringify(marker)}`)
}
