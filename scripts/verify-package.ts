import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

interface PackageManifest {
  name?: string
  private?: boolean
  files?: string[]
  publishConfig?: { access?: string; registry?: string }
}

interface PackedFile {
  path: string
  size: number
}

interface PackResult {
  name: string
  version: string
  size: number
  unpackedSize: number
  files: PackedFile[]
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest
const errors: string[] = []

if (manifest.name !== 'vite-link') errors.push('package name must be `vite-link`')
if (manifest.private === true) errors.push('package must not be marked private')
if (manifest.publishConfig?.access !== 'public') {
  errors.push('publishConfig.access must be `public`')
}
if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org') {
  errors.push('publishConfig.registry must target the public npm registry')
}
if (JSON.stringify(manifest.files) !== JSON.stringify(['dist', 'docs', 'LICENSE'])) {
  errors.push('the npm file allowlist must contain only `dist`, `docs`, and `LICENSE`')
}

const output = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json'])
const [packed] = JSON.parse(output) as PackResult[]
if (!packed) errors.push('npm did not return a package inspection result')

if (packed) {
  const paths = new Set(packed.files.map((file) => file.path))
  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    'docs/ADAPTERS.md',
    'docs/ARCHITECTURE.md',
    'docs/CONFIGURATION.md',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/plugin.js',
    'dist/plugin.cjs',
    'dist/nest.js',
    'dist/nest.cjs',
    'dist/runtime.js',
    'dist/runtime.cjs',
    'dist/cli/bin.js',
  ]

  for (const path of required) {
    if (!paths.has(path)) errors.push(`packed artifact is missing ${path}`)
  }

  for (const path of paths) {
    if (
      !['package.json', 'README.md', 'LICENSE'].includes(path) &&
      !path.startsWith('dist/') &&
      !path.startsWith('docs/')
    ) {
      errors.push(`unexpected file in npm package: ${path}`)
    }
  }

  if (packed.files.length > 100)
    errors.push(`package contains too many files: ${packed.files.length}`)
  if (packed.size > 250_000) errors.push(`compressed package exceeds 250 kB: ${packed.size}`)
  if (packed.unpackedSize > 1_000_000) {
    errors.push(`unpacked package exceeds 1 MB: ${packed.unpackedSize}`)
  }
}

if (errors.length > 0) {
  throw new Error(`Package inspection failed:\n- ${errors.join('\n- ')}`)
}

process.stdout.write(
  `[vite-link] package inspection passed (${packed?.files.length ?? 0} files, ${packed?.size ?? 0} bytes compressed)\n`,
)

function runNpm(args: string[]): string {
  if (process.platform !== 'win32') {
    return execFileSync('npm', args, { encoding: 'utf8' })
  }

  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8' })
}
