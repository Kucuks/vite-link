import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSourceMapPaths } from '../scripts/normalize-source-maps'

describe('published source maps', () => {
  const root = resolve('source-map-fixture')
  const mapFile = join(root, 'dist/index.cjs.map')

  it('removes builder paths while preserving mappings and embedded source', () => {
    const map = {
      version: 3,
      file: join(root, 'dist/index.cjs'),
      sources: [
        join(root, 'dist/index.cjs'),
        '../src/index.ts',
        pathToFileURL(join(root, 'src/plugin.ts')).href,
      ],
      sourcesContent: ['compiled', 'original', 'plugin'],
      names: ['value'],
      mappings: 'AAAA',
    }
    const normalized = normalizeSourceMapPaths(map, mapFile, root)
    expect(normalized.file).toBe('index.cjs')
    expect(normalized.sources).toEqual(['index.cjs', '../src/index.ts', '../src/plugin.ts'])
    expect(normalized.sourcesContent).toEqual(map.sourcesContent)
    expect(normalized.names).toEqual(map.names)
    expect(normalized.mappings).toBe('AAAA')
    expect(map.sources[0]).toBe(join(root, 'dist/index.cjs'))
  })

  it('resolves an absolute sourceRoot before removing it', () => {
    const normalized = normalizeSourceMapPaths(
      { sourceRoot: join(root, 'src'), sources: ['index.ts'] },
      mapFile,
      root,
    )
    expect(normalized.sources).toEqual(['../src/index.ts'])
    expect(normalized.sourceRoot).toBeUndefined()
  })

  it('rejects build inputs outside the project instead of publishing their paths', () => {
    expect(() =>
      normalizeSourceMapPaths({ sources: [resolve(root, '../private/key.ts')] }, mapFile, root),
    ).toThrow(/outside the build project/)
  })

  it('rejects an absolute output file outside the build project', () => {
    expect(() =>
      normalizeSourceMapPaths(
        { file: resolve(root, '../private/output.cjs'), sources: [] },
        mapFile,
        root,
      ),
    ).toThrow(/outside the build project/)
  })

  it('preserves relative sourceRoot semantics when mixed with an absolute source', () => {
    const normalized = normalizeSourceMapPaths(
      { sourceRoot: '../src', sources: ['index.ts', join(root, 'src/plugin.ts')] },
      mapFile,
      root,
    )
    expect(normalized.sources).toEqual(['../src/index.ts', '../src/plugin.ts'])
    expect(normalized.sourceRoot).toBeUndefined()
  })
})
