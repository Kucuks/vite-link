import { resolve } from 'node:path'
import type { Diagnostic, ResolvedViteLinkConfig } from '../types'
import { fileExists, readText } from '../core/fs'
import { getCompilerOptions } from '../core/tsconfig'
import { looksLikeSecretName } from '../core/env-policy'

const NATIVE_DEPENDENCIES = [
  'bcrypt',
  'argon2',
  'sharp',
  'canvas',
  'sqlite3',
  'better-sqlite3',
  'pg-native',
  'grpc',
  '@prisma/client',
]

export async function runConfigDiagnostics(config: ResolvedViteLinkConfig): Promise<Diagnostic[]> {
  return [
    ...checkTsconfig(config),
    ...(await checkEntry(config)),
    ...checkPackage(config),
    ...checkEnvInlining(config),
    ...checkMetadata(config),
    ...(await checkViteConfigText(config)),
  ]
}

function checkMetadata(config: ResolvedViteLinkConfig): Diagnostic[] {
  if (!config.metadata.enabled || config.metadata.commands.length > 0) return []
  return [
    {
      code: 'METADATA_COMMAND_REQUIRED',
      severity: 'error',
      message: 'Metadata generation is enabled but no command is configured.',
      hint: 'Add at least one explicit command to `metadata.commands` or disable metadata generation.',
    },
  ]
}

function checkTsconfig(config: ResolvedViteLinkConfig): Diagnostic[] {
  const options = getCompilerOptions(config.tsconfigRaw)
  const diagnostics: Diagnostic[] = []

  if (options.isolatedModules !== true) {
    diagnostics.push({
      code: 'TS_ISOLATED_MODULES_RECOMMENDED',
      severity: 'warn',
      file: config.tsconfig,
      message: '`isolatedModules` is not enabled.',
      hint: 'Vite transforms files independently. Enabling isolatedModules catches incompatible TypeScript patterns earlier.',
    })
  }

  return diagnostics
}

async function checkEntry(config: ResolvedViteLinkConfig): Promise<Diagnostic[]> {
  if (!(await fileExists(config.entry))) {
    return [
      {
        code: 'ENTRY_NOT_FOUND',
        severity: 'fatal',
        file: config.entry,
        message: `Entry file not found: ${config.entry}`,
      },
    ]
  }

  return []
}

function checkPackage(config: ResolvedViteLinkConfig): Diagnostic[] {
  const dependencies = {
    ...(isRecord(config.packageJson.dependencies) ? config.packageJson.dependencies : {}),
    ...(isRecord(config.packageJson.optionalDependencies)
      ? config.packageJson.optionalDependencies
      : {}),
  }

  return NATIVE_DEPENDENCIES.filter(
    (dependency) =>
      dependency in dependencies && !config.external.alwaysExternal.includes(dependency),
  ).map((dependency) => ({
    code: 'NATIVE_DEP_NOT_EXTERNAL',
    severity: 'warn',
    file: config.packageJsonPath,
    message: `Native or binary dependency "${dependency}" should stay external.`,
    hint: 'Add it to `external.alwaysExternal` to avoid broken native binary resolution.',
  }))
}

function checkEnvInlining(config: ResolvedViteLinkConfig): Diagnostic[] {
  if (!config.env.forbidInlineSecrets) return []
  return config.env.inline.filter(looksLikeSecretName).map((key) => ({
    code: 'ENV_INLINE_SECRET_BLOCKED',
    severity: 'error',
    message: `Environment variable "${key}" looks secret-like and must not be inlined into the bundle.`,
    hint: 'Keep secrets runtime-only through process.env. Inline only safe constants such as NODE_ENV.',
  }))
}

async function checkViteConfigText(config: ResolvedViteLinkConfig): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (const file of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
    const path = resolve(config.root, file)
    if (!(await fileExists(path))) continue
    const text = await readText(path)
    if (/['"]process\.env['"]\s*:\s*JSON\.stringify\(process\.env\)/.test(text)) {
      diagnostics.push({
        code: 'PROCESS_ENV_INLINED',
        severity: 'fatal',
        file: path,
        message: '`process.env` is being inlined into the bundle.',
        hint: 'Never inline secrets. Keep runtime env access and inline only safe constants such as NODE_ENV.',
      })
    }
  }
  return diagnostics
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
