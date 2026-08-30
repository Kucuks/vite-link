import { performance } from 'node:perf_hooks'

export interface Samples {
  repetitions: number
  warmupRepetitions: number
  minMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  meanMs: number
  standardDeviationMs: number
  coefficientOfVariation: number
}

export interface SoakSamples extends Samples {
  rssAfterEachRunBytes: number[]
  heapUsedAfterEachRunBytes: number[]
  rssGrowthBytes: number
  heapUsedGrowthBytes: number
  peakRssBytes: number
  interpretation: string
}

export async function measure(
  repetitions: number,
  operation: () => Promise<void>,
): Promise<Samples> {
  await operation()
  const values: number[] = []
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now()
    await operation()
    values.push(performance.now() - started)
  }
  return summarize(values, repetitions)
}

export async function measureWithMemory(
  repetitions: number,
  operation: () => Promise<void>,
): Promise<SoakSamples> {
  await operation()
  const values: number[] = []
  const rssAfterEachRunBytes: number[] = []
  const heapUsedAfterEachRunBytes: number[] = []
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now()
    await operation()
    values.push(performance.now() - started)
    const memory = process.memoryUsage()
    rssAfterEachRunBytes.push(memory.rss)
    heapUsedAfterEachRunBytes.push(memory.heapUsed)
  }
  return {
    ...summarize(values, repetitions),
    rssAfterEachRunBytes,
    heapUsedAfterEachRunBytes,
    rssGrowthBytes: (rssAfterEachRunBytes.at(-1) ?? 0) - (rssAfterEachRunBytes[0] ?? 0),
    heapUsedGrowthBytes:
      (heapUsedAfterEachRunBytes.at(-1) ?? 0) - (heapUsedAfterEachRunBytes[0] ?? 0),
    peakRssBytes: Math.max(...rssAfterEachRunBytes),
    interpretation:
      'Ten-build same-process local soak. Growth includes runtime and bundler caches; it is a regression signal, not proof of a memory leak.',
  }
}

function summarize(values: number[], repetitions: number): Samples {
  values.sort((a, b) => a - b)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length
  const standardDeviation = Math.sqrt(variance)
  return {
    repetitions,
    warmupRepetitions: 1,
    minMs: round(values[0] ?? 0),
    p50Ms: round(percentile(values, 0.5)),
    p95Ms: round(percentile(values, 0.95)),
    maxMs: round(values.at(-1) ?? 0),
    meanMs: round(mean),
    standardDeviationMs: round(standardDeviation),
    coefficientOfVariation: round(mean === 0 ? 0 : standardDeviation / mean),
  }
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0
  const index = Math.ceil(quantile * values.length) - 1
  return values[Math.max(0, Math.min(values.length - 1, index))] ?? 0
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
