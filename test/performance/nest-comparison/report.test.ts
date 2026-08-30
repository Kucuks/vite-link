import { describe, expect, it } from 'vitest'
import type { Samples } from '../statistics'
import { renderMarkdown } from './report'
import type { ComparisonResult } from './types'

describe('Nest comparison report', () => {
  it('marks unstable comparisons inconclusive and renders zero parity without NaN', () => {
    const result = createResult()
    const markdown = renderMarkdown(result)

    expect(markdown).toContain('inconclusive (CV 20% / 5%)')
    expect(markdown).toContain('Dev reload: edit to revised /health p50')
    expect(markdown).toContain('| HTTP parity latency p97.5 | 0 ms | 0 ms | equal |')
    expect(markdown).not.toContain('NaN')
    expect(markdown).toContain('0 total failures')
  })

  it('treats a stable HTTP throughput delta within five percent as runtime parity', () => {
    const result = createResult()
    result.metrics.httpParity.viteLink.throughputRequestsPerSecond = samples(100, 0.02)
    result.metrics.httpParity.nestVanilla.throughputRequestsPerSecond = samples(103, 0.02)

    expect(renderMarkdown(result)).toContain('parity (within ±5%)')
  })

  it('marks unstable build timing comparisons inconclusive', () => {
    const result = createResult()
    result.metrics.cleanBuildMs.viteLink = samples(100, 0.2)
    result.metrics.cleanBuildMs.nestVanilla = samples(110, 0.05)

    expect(renderMarkdown(result)).toContain(
      '| Clean production build p50 | 100 ms | 110 ms | inconclusive (CV 20% / 5%) |',
    )
  })
})

function createResult(): ComparisonResult {
  const stable = samples(100, 0.02)
  const zero = samples(0, 0)
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-30T00:00:00.000Z',
    claimBoundary: 'Test boundary.',
    methodology: {
      build: 'build',
      startup: 'startup',
      development: 'development',
      http: 'http',
    },
    identity: {
      commit: undefined,
      dirty: undefined,
      node: 'v22.0.0',
      platform: 'test-x64',
      logicalCpuCount: 1,
      totalMemoryBytes: 1,
      packageVersions: {},
    },
    workload: {
      featureModules: 1,
      sourceFilesPerVariant: 3,
      buildRepetitions: 1,
      startupRepetitions: 1,
      devStartupRepetitions: 1,
      devEditRepetitions: 1,
      httpRounds: 1,
      httpDurationSecondsPerRound: 1,
      httpConnections: 1,
      httpWarmupSecondsPerRound: 1,
    },
    metrics: {
      cleanBuildMs: { viteLink: stable, nestVanilla: stable },
      startupToHealthMs: { viteLink: stable, nestVanilla: stable },
      devStartupToHealthMs: { viteLink: stable, nestVanilla: stable },
      devEditToHealthMs: { viteLink: stable, nestVanilla: stable },
      output: {
        viteLink: { files: 1, bytes: 1, entryBytes: 1 },
        nestVanilla: { files: 1, bytes: 1, entryBytes: 1 },
      },
      httpParity: {
        viteLink: {
          throughputRequestsPerSecond: samples(100, 0.2),
          averageLatencyMs: stable,
          latencyP97_5Ms: zero,
          totalRequests: 100,
          failures: 0,
          rounds: [],
        },
        nestVanilla: {
          throughputRequestsPerSecond: samples(110, 0.05),
          averageLatencyMs: stable,
          latencyP97_5Ms: zero,
          totalRequests: 110,
          failures: 0,
          rounds: [],
        },
      },
    },
  }
}

function samples(value: number, coefficientOfVariation: number): Samples {
  return {
    repetitions: 1,
    warmupRepetitions: 1,
    minMs: value,
    p50Ms: value,
    p95Ms: value,
    maxMs: value,
    meanMs: value,
    standardDeviationMs: 0,
    coefficientOfVariation,
  }
}
