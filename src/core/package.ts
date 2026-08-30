import { dirname, resolve } from 'node:path'
import { findUp, readJson } from './fs'

export async function readNearestPackageJson(root: string): Promise<{
  path?: string
  json: Record<string, unknown>
}> {
  const path = await findUp('package.json', root)
  if (!path) return { json: {} }
  return { path, json: await readJson(path) }
}

export function getPackageDependencyNames(
  pkg: Record<string, unknown>,
  options: { dependencies?: boolean; devDependencies?: boolean; peerDependencies?: boolean },
): string[] {
  const names = new Set<string>()

  if (options.dependencies !== false) addKeys(names, pkg.dependencies)
  if (options.devDependencies) addKeys(names, pkg.devDependencies)
  if (options.peerDependencies !== false) addKeys(names, pkg.peerDependencies)

  return Array.from(names).sort()
}

function addKeys(target: Set<string>, value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const key of Object.keys(value)) target.add(key)
}

export function getPackageType(pkg: Record<string, unknown>): 'module' | 'commonjs' | undefined {
  const type = pkg.type
  if (type === 'module') return 'module'
  if (type === 'commonjs') return 'commonjs'
  return undefined
}

export function resolvePackageRoot(packageJsonPath: string | undefined, fallback: string): string {
  return packageJsonPath ? dirname(packageJsonPath) : resolve(fallback)
}
