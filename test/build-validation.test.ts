import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveViteKitConfig } from '../src/config/defaults'
import { validateBuildOutput } from '../src/cli/validate'
import { createFixture } from './helpers'

describe('build output validation', () => {
  it('fails when the expected build entry is missing', async () => {
    const root = await createFixture()
    const config = await resolveViteKitConfig({ root })

    await expect(validateBuildOutput(config)).rejects.toThrow(/Expected build entry/)
  })

  it('accepts a non-empty emitted entry', async () => {
    const root = await createFixture()
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist/main.cjs'), 'console.log("ok")')
    const config = await resolveViteKitConfig({ root })

    await expect(validateBuildOutput(config)).resolves.toMatchObject({ size: expect.any(Number) })
  })
})
