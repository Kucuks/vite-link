import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveViteLinkConfig } from '../src/config/defaults'
import { fileExists } from '../src/core/fs'
import { runDiagnostics } from '../src/diagnostics'
import { collectMetadataCommands, startMetadataWatcher } from '../src/metadata'
import { createFixture } from './helpers'

describe('metadata pipeline', () => {
  it('rejects enabled metadata generation without an explicit command', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({ root, metadata: { enabled: true } })
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some(({ code }) => code === 'METADATA_COMMAND_REQUIRED')).toBe(true)
  })

  it('uses only explicit project-owned commands', async () => {
    const root = await createFixture()
    const config = await resolveViteLinkConfig({
      root,
      metadata: { commands: ['generate-openapi', 'generate-graphql'] },
    })

    expect(collectMetadataCommands(config)).toEqual(['generate-openapi', 'generate-graphql'])
  })

  it('cancels debounced generation when the watcher closes', async () => {
    const root = await createFixture()
    const marker = join(root, 'metadata-ran.txt')
    const script = join(root, 'generate-metadata.mjs')
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran')`,
    )
    const config = await resolveViteLinkConfig({
      root,
      dev: { debounce: 200 },
      metadata: {
        commands: [`"${process.execPath}" "${script}"`],
        watch: true,
      },
    })
    const watcher = startMetadataWatcher(config)
    expect(watcher).toBeDefined()
    await watcher!.ready

    await writeFile(join(root, 'src/main.ts'), 'export const changed = true')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    await watcher!.close()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))

    expect(await fileExists(marker)).toBe(false)
  })
})
