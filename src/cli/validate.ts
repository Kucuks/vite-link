import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ResolvedViteKitConfig } from '../types'

export interface BuildValidationResult {
  entry: string
  size: number
}

export async function validateBuildOutput(
  config: ResolvedViteKitConfig,
): Promise<BuildValidationResult> {
  const entry = resolve(config.root, config.build.outDir, config.build.entryFileName)

  try {
    const info = await stat(entry)
    if (!info.isFile()) throw new Error(`Build entry is not a file: ${entry}`)
    if (info.size === 0) throw new Error(`Build entry is empty: ${entry}`)
    return { entry, size: info.size }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Build entry')) throw error
    throw new Error(
      `Expected build entry was not emitted: ${entry}. Check build.entryFileName, build.format and Vite output settings.`,
      {
        cause: error,
      },
    )
  }
}
