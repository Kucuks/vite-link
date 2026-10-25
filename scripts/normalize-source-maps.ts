import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SourceMapPaths {
  sources: string[]
  sourceRoot?: string
  file?: string
  [key: string]: unknown
}

export function normalizeSourceMapPaths(
  map: SourceMapPaths,
  mapFile: string,
  projectRoot: string,
): SourceMapPaths {
  const sourceRoot = map.sourceRoot
  const rootIsAbsolute = Boolean(
    sourceRoot && (isAbsolute(sourceRoot) || sourceRoot.startsWith('file:')),
  )
  const flattenRoot =
    rootIsAbsolute ||
    Boolean(
      sourceRoot && map.sources.some((source) => isAbsolute(source) || source.startsWith('file:')),
    )
  const relativeBuildPath = (target: string): string => {
    const withinProject = relative(projectRoot, target)
    if (
      isAbsolute(withinProject) ||
      withinProject === '..' ||
      withinProject.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))
    ) {
      throw new Error('Source map references an absolute path outside the build project')
    }
    return relative(dirname(mapFile), target).replaceAll('\\', '/')
  }
  const sources = map.sources.map((source) => {
    let target = source.startsWith('file:') ? fileURLToPath(source) : source
    if (!isAbsolute(target) && !flattenRoot) return source
    if (!isAbsolute(target) && sourceRoot) {
      target = resolve(
        sourceRoot.startsWith('file:')
          ? fileURLToPath(sourceRoot)
          : resolve(dirname(mapFile), sourceRoot),
        target,
      )
    }
    return relativeBuildPath(target)
  })
  const normalized = { ...map, sources }
  if (flattenRoot) delete normalized.sourceRoot
  if (typeof map.file === 'string' && (isAbsolute(map.file) || map.file.startsWith('file:'))) {
    normalized.file = relativeBuildPath(
      map.file.startsWith('file:') ? fileURLToPath(map.file) : map.file,
    )
  }
  return normalized
}

async function normalizeBuildMaps(directory: string, projectRoot: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await normalizeBuildMaps(file, projectRoot)
    else if (entry.isFile() && entry.name.endsWith('.map')) {
      const map = JSON.parse(await readFile(file, 'utf8')) as SourceMapPaths
      await writeFile(file, JSON.stringify(normalizeSourceMapPaths(map, file, projectRoot)))
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const projectRoot = resolve(import.meta.dirname, '..')
  await normalizeBuildMaps(join(projectRoot, 'dist'), projectRoot)
}
