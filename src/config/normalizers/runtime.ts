import type {
  DiagnosticsOptions,
  EnvOptions,
  MetadataOptions,
  ResolvedViteLinkConfig,
  TypecheckOptions,
  ViteLinkOptions,
} from '../../types'

export type ResolveMode = 'development' | 'production' | 'diagnostics'

export function normalizeTypecheck(
  value: ViteLinkOptions['typecheck'],
  tsconfig: string,
): Required<TypecheckOptions> {
  if (value === false) return { dev: false, build: false, tsconfig }
  if (value === true || value === undefined) return { dev: 'async', build: 'before', tsconfig }
  return {
    dev: value.dev ?? 'async',
    build: value.build ?? 'before',
    tsconfig: value.tsconfig ?? tsconfig,
  }
}

export function normalizeMetadata(value: ViteLinkOptions['metadata']): Required<MetadataOptions> {
  if (value === false || value === undefined) {
    return { enabled: false, commands: [], watch: false }
  }
  return {
    enabled: value.enabled ?? Boolean(value.commands?.length),
    commands: value.commands ?? [],
    watch: value.watch ?? false,
  }
}

export function normalizeDiagnostics(
  value: ViteLinkOptions['diagnostics'],
  mode: ResolveMode,
): Required<DiagnosticsOptions> {
  if (value === false) return { enabled: false, strict: false, scanSource: false, failOn: 'fatal' }
  if (value === true || value === undefined) {
    return { enabled: true, strict: mode === 'production', scanSource: true, failOn: 'error' }
  }
  return {
    enabled: value.enabled ?? true,
    strict: value.strict ?? mode === 'production',
    scanSource: value.scanSource ?? true,
    failOn: value.failOn ?? 'error',
  }
}

export function normalizeDev(value: ViteLinkOptions['dev']): ResolvedViteLinkConfig['dev'] {
  return {
    strategy: value?.strategy ?? 'restart',
    port: value?.port ?? 3_000,
    debounce: value?.debounce ?? 80,
    gracefulTimeout: value?.gracefulTimeout ?? 5_000,
    killSignal: value?.killSignal ?? 'SIGTERM',
    forceKillSignal: value?.forceKillSignal ?? 'SIGKILL',
    nodeArgs: value?.nodeArgs ?? ['--enable-source-maps'],
    env: value?.env ?? {},
  }
}

export function normalizeMonorepo(
  value: ViteLinkOptions['monorepo'],
): ResolvedViteLinkConfig['monorepo'] {
  return {
    dedupe: value?.dedupe ?? [],
  }
}

export function normalizeEnv(value: EnvOptions | undefined): Required<EnvOptions> {
  return {
    inline: value?.inline ?? [],
    keepRuntime: value?.keepRuntime ?? true,
    forbidInlineSecrets: value?.forbidInlineSecrets ?? true,
  }
}
