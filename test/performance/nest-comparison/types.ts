import type { Samples } from '../statistics'

export type Variant = 'viteLink' | 'nestVanilla'

export interface CommandSpec {
  command: string
  args: string[]
  cwd: string
}

export interface OutputStats {
  files: number
  bytes: number
  entryBytes: number
}

export interface HttpSamples {
  throughputRequestsPerSecond: Samples
  averageLatencyMs: Samples
  latencyP97_5Ms: Samples
  totalRequests: number
  failures: number
  rounds: HttpRound[]
}

export interface HttpRound {
  requestsPerSecond: number
  averageLatencyMs: number
  latencyP97_5Ms: number
  totalRequests: number
  failures: number
}

export interface Comparison<T> {
  viteLink: T
  nestVanilla: T
}

export interface BenchmarkOptions {
  featureModules: number
  buildRepetitions: number
  startupRepetitions: number
  devStartupRepetitions: number
  devEditRepetitions: number
  httpRounds: number
  httpDurationSeconds: number
  httpConnections: number
  httpWarmupSeconds: number
  outputPath: string | undefined
}

export interface ComparisonResult {
  schemaVersion: 1
  generatedAt: string
  claimBoundary: string
  methodology: {
    build: string
    startup: string
    development: string
    http: string
  }
  identity: {
    commit: string | undefined
    dirty: boolean | undefined
    node: string
    platform: string
    logicalCpuCount: number
    totalMemoryBytes: number
    packageVersions: Record<string, string>
  }
  workload: {
    featureModules: number
    sourceFilesPerVariant: number
    buildRepetitions: number
    startupRepetitions: number
    devStartupRepetitions: number
    devEditRepetitions: number
    httpRounds: number
    httpDurationSecondsPerRound: number
    httpConnections: number
    httpWarmupSecondsPerRound: number
  }
  metrics: {
    cleanBuildMs: Comparison<Samples>
    startupToHealthMs: Comparison<Samples>
    devStartupToHealthMs: Comparison<Samples>
    devEditToHealthMs: Comparison<Samples>
    output: Comparison<OutputStats>
    httpParity: Comparison<HttpSamples>
  }
}
