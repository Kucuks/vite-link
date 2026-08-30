import { resolve } from 'node:path'
import type { AssetPattern, ViteKitOptions } from '../../types'
import { dirExists } from '../../core/fs'

export async function normalizeAssets(
  root: string,
  assets: ViteKitOptions['assets'],
): Promise<AssetPattern[]> {
  const configured = assets ?? []
  const defaults: AssetPattern[] = []

  if ((await dirExists(resolve(root, 'src/i18n'))) && !hasAssetInclude(configured, 'src/i18n')) {
    defaults.push({ include: ['src/i18n/**/*'], base: 'src', restart: false })
  }
  return [...defaults, ...configured]
}

function hasAssetInclude(assets: AssetPattern[], needle: string): boolean {
  return assets.some((asset) => {
    const include = Array.isArray(asset.include) ? asset.include : [asset.include]
    return include.some((pattern) => pattern.replaceAll('\\', '/').startsWith(needle))
  })
}
