import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { build } from 'vite'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { runDiagnostics } from '../src/diagnostics'
import { viteLink } from '../src/plugin'
import type { ViteLinkAdapter } from '../src/types'
import { createFixture } from './helpers'

describe('adapter API', () => {
  it('runs a custom adapter in direct Vite builds and diagnostics', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'src/main.ts'), "export const adapterMarker = 'before-adapter'\n")
    const pluginFactory = vi.fn(() => [
      {
        name: 'test:adapter-transform',
        transform(code: string, id: string) {
          return id.endsWith('main.ts') ? code.replace('before-adapter', 'after-adapter') : null
        },
      },
    ])
    const adapter: ViteLinkAdapter = {
      name: 'test-adapter',
      plugins: pluginFactory,
      configDiagnostics: () => [
        { code: 'TEST_ADAPTER_CONFIG', severity: 'info', message: 'config adapter ran' },
      ],
      sourceDiagnostics: ({ file, sourceFile }) =>
        file.endsWith('main.ts') && sourceFile.statements.length > 0
          ? [{ code: 'TEST_ADAPTER_SOURCE', severity: 'info', message: 'source adapter ran' }]
          : [],
    }

    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [viteLink({ root, adapters: [adapter], diagnostics: false, typecheck: false })],
    })

    const output = await readFile(join(root, 'dist/main.cjs'), 'utf8')
    expect(output).toContain('after-adapter')
    expect(pluginFactory).toHaveBeenCalledTimes(1)

    const config = await resolveViteLinkConfig({ root, adapters: [adapter] }, 'diagnostics')
    const diagnostics = await runDiagnostics(config)
    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['TEST_ADAPTER_CONFIG', 'TEST_ADAPTER_SOURCE']),
    )
  })
})
