import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSourceMapPaths } from '../scripts/normalize-source-maps'
import { inspectPackedContent } from '../scripts/package-content'
import linuxFixture from './fixtures/linux-source-map-paths.json'

describe('published source maps', () => {
  it('checks all 18 real Linux map path records with the packed-archive inspector', () => {
    expect(linuxFixture.maps).toHaveLength(18)
    let rejectedOriginals = 0
    for (const record of linuxFixture.maps) {
      const map = { ...record.map, mappings: 'AAAA', sourcesContent: ['preserved source'] }
      if (inspectPackedContent(record.path, JSON.stringify(map)).length > 0) rejectedOriginals++
      const normalized = normalizeSourceMapPaths(
        map,
        `${linuxFixture.projectRoot}/${record.path}`,
        linuxFixture.projectRoot,
      )
      expect(inspectPackedContent(record.path, JSON.stringify(normalized))).toEqual([])
      expect(normalized.mappings).toBe(map.mappings)
      expect(normalized.sourcesContent).toEqual(map.sourcesContent)
    }
    expect(rejectedOriginals).toBe(9)
  })

  it('inspects non-map packed files without echoing secret-like values', () => {
    const synthetic = 'npm_' + 'x'.repeat(32)
    const errors = inspectPackedContent('dist/example.js', `export const token = '${synthetic}'`)
    expect(errors).toHaveLength(1)
    expect(errors.join()).not.toContain(synthetic)
  })
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
