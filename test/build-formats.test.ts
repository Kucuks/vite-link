import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { createViteInlineConfig } from '../src/config/vite'
import { createFixture } from './helpers'

describe('build formats', () => {
  it('emits an executable ESM entry', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(join(root, 'src/value.ts'), "export const value = 'esm-output'\n")
    await writeFile(join(root, 'src/main.ts'), "export { value } from './value'\n")
    const config = await resolveViteLinkConfig({
      root,
      diagnostics: false,
      typecheck: false,
      build: { format: 'esm' },
    })

    await build({ ...createViteInlineConfig(config), configFile: false, logLevel: 'silent' })

    const output = await import(pathToFileURL(join(root, 'dist/main.mjs')).href)
    expect(output.value).toBe('esm-output')
  })

  it('preserves module boundaries without overwriting emitted files', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(join(root, 'src/value.ts'), "export const value = 'preserved-output'\n")
    await writeFile(join(root, 'src/main.ts'), "export { value } from './value'\n")
    const config = await resolveViteLinkConfig({
      root,
      diagnostics: false,
      typecheck: false,
      build: { format: 'esm', preserveModules: true },
    })

    await build({ ...createViteInlineConfig(config), configFile: false, logLevel: 'silent' })

    const emittedModules = await fg('**/*.mjs', { cwd: join(root, 'dist') })
    const entry = await readFile(join(root, 'dist/main.mjs'), 'utf8')
    const output = await import(pathToFileURL(join(root, 'dist/main.mjs')).href)
    expect(emittedModules.length).toBeGreaterThan(1)
    expect(entry).toMatch(/from\s+["'].+\.mjs["']/)
    expect(output.value).toBe('preserved-output')
  })
})
