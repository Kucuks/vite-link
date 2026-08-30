import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputStats } from './types'

export async function measureOutput(root: string, entry: string): Promise<OutputStats> {
  const aggregate = await walkOutput(root)
  return { ...aggregate, entryBytes: (await stat(entry)).size }
}

async function walkOutput(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await walkOutput(path)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += (await stat(path)).size
    }
  }
  return { files, bytes }
}
