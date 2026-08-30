import type { ExternalOptions } from '../../types'
import { getPackageDependencyNames } from '../../core/package'

const DEFAULT_EXTERNAL = [
  'typeorm',
  'mikro-orm',
  '@mikro-orm/core',
  '@prisma/client',
  'prisma',
  'mongoose',
  'sequelize',
  'pg',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'bcrypt',
  'bcryptjs',
  'argon2',
  'sharp',
  'canvas',
  'grpc',
  '@grpc/grpc-js',
]

export function normalizeExternal(
  value: ExternalOptions | undefined,
  packageJson: Record<string, unknown>,
): Required<ExternalOptions> {
  const dependencies = value?.dependencies ?? true
  const devDependencies = value?.devDependencies ?? false
  const peerDependencies = value?.peerDependencies ?? true
  const dependencyNames = getPackageDependencyNames(packageJson, {
    dependencies,
    devDependencies,
    peerDependencies,
  })

  return {
    dependencies,
    devDependencies,
    peerDependencies,
    include: value?.include ?? dependencyNames,
    exclude: value?.exclude ?? [],
    alwaysExternal: [...DEFAULT_EXTERNAL, ...(value?.alwaysExternal ?? [])],
    noExternal: value?.noExternal ?? [],
  }
}
