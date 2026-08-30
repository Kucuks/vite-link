import { round } from '../statistics'
import type { ComparisonResult } from './types'

export function renderMarkdown(result: ComparisonResult): string {
  const metrics = result.metrics
  const rows = [
    row(
      'Clean production build p50',
      metrics.cleanBuildMs.viteLink.p50Ms,
      metrics.cleanBuildMs.nestVanilla.p50Ms,
      'ms',
      false,
      metrics.cleanBuildMs,
    ),
    row(
      'Clean production build p95',
      metrics.cleanBuildMs.viteLink.p95Ms,
      metrics.cleanBuildMs.nestVanilla.p95Ms,
      'ms',
      false,
      metrics.cleanBuildMs,
    ),
    row(
      'Startup to /health p50',
      metrics.startupToHealthMs.viteLink.p50Ms,
      metrics.startupToHealthMs.nestVanilla.p50Ms,
      'ms',
      false,
      metrics.startupToHealthMs,
    ),
    row(
      'Startup to /health p95',
      metrics.startupToHealthMs.viteLink.p95Ms,
      metrics.startupToHealthMs.nestVanilla.p95Ms,
      'ms',
      false,
      metrics.startupToHealthMs,
    ),
    row(
      'Dev cold start to /health p50',
      metrics.devStartupToHealthMs.viteLink.p50Ms,
      metrics.devStartupToHealthMs.nestVanilla.p50Ms,
      'ms',
      false,
      metrics.devStartupToHealthMs,
    ),
    row(
      'Dev cold start to /health p95',
      metrics.devStartupToHealthMs.viteLink.p95Ms,
      metrics.devStartupToHealthMs.nestVanilla.p95Ms,
      'ms',
      false,
      metrics.devStartupToHealthMs,
    ),
    row(
      'Dev reload: edit to revised /health p50',
      metrics.devEditToHealthMs.viteLink.p50Ms,
      metrics.devEditToHealthMs.nestVanilla.p50Ms,
      'ms',
      false,
      metrics.devEditToHealthMs,
    ),
    row(
      'Dev reload: edit to revised /health p95',
      metrics.devEditToHealthMs.viteLink.p95Ms,
      metrics.devEditToHealthMs.nestVanilla.p95Ms,
      'ms',
      false,
      metrics.devEditToHealthMs,
    ),
    row(
      'HTTP parity throughput mean',
      metrics.httpParity.viteLink.throughputRequestsPerSecond.meanMs,
      metrics.httpParity.nestVanilla.throughputRequestsPerSecond.meanMs,
      'req/s',
      true,
      {
        viteLink: metrics.httpParity.viteLink.throughputRequestsPerSecond,
        nestVanilla: metrics.httpParity.nestVanilla.throughputRequestsPerSecond,
        equivalencePercent: 5,
      },
    ),
    row(
      'HTTP parity latency mean',
      metrics.httpParity.viteLink.averageLatencyMs.meanMs,
      metrics.httpParity.nestVanilla.averageLatencyMs.meanMs,
      'ms',
      false,
      {
        viteLink: metrics.httpParity.viteLink.averageLatencyMs,
        nestVanilla: metrics.httpParity.nestVanilla.averageLatencyMs,
      },
    ),
    row(
      'HTTP parity latency p97.5',
      metrics.httpParity.viteLink.latencyP97_5Ms.meanMs,
      metrics.httpParity.nestVanilla.latencyP97_5Ms.meanMs,
      'ms',
      false,
      {
        viteLink: metrics.httpParity.viteLink.latencyP97_5Ms,
        nestVanilla: metrics.httpParity.nestVanilla.latencyP97_5Ms,
      },
    ),
    row(
      'Emitted bytes',
      metrics.output.viteLink.bytes,
      metrics.output.nestVanilla.bytes,
      'B',
      false,
    ),
    row(
      'Emitted files',
      metrics.output.viteLink.files,
      metrics.output.nestVanilla.files,
      '',
      false,
    ),
  ]
  return [
    '# Vite Link vs vanilla Nest',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '| Metric | Vite Link | Vanilla Nest | Vite Link delta |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    '',
    `Workload: ${result.workload.featureModules} feature modules; ${result.workload.buildRepetitions} build, ${result.workload.startupRepetitions} production startup, ${result.workload.devStartupRepetitions} dev startup and ${result.workload.devEditRepetitions} dev edit repetitions; Node ${result.identity.node}; ${result.identity.platform}.`,
    `HTTP sample: ${metrics.httpParity.viteLink.totalRequests.toLocaleString('en-US')} Vite Link requests and ${metrics.httpParity.nestVanilla.totalRequests.toLocaleString('en-US')} vanilla Nest requests; ${metrics.httpParity.viteLink.failures + metrics.httpParity.nestVanilla.failures} total failures.`,
    '',
    `Boundary: ${result.claimBoundary}`,
  ].join('\n')
}

function row(
  label: string,
  viteLink: number,
  nestVanilla: number,
  unit: string,
  higherIsBetter: boolean,
  stability?: {
    viteLink: { coefficientOfVariation: number }
    nestVanilla: { coefficientOfVariation: number }
    equivalencePercent?: number
  },
): string {
  if (
    stability &&
    Math.max(
      stability.viteLink.coefficientOfVariation,
      stability.nestVanilla.coefficientOfVariation,
    ) > 0.1
  ) {
    const unitSuffix = unit ? ` ${unit}` : ''
    const viteCv = format(stability.viteLink.coefficientOfVariation * 100)
    const nestCv = format(stability.nestVanilla.coefficientOfVariation * 100)
    return `| ${label} | ${format(viteLink)}${unitSuffix} | ${format(nestVanilla)}${unitSuffix} | inconclusive (CV ${viteCv}% / ${nestCv}%) |`
  }
  if (nestVanilla === 0) {
    const unitSuffix = unit ? ` ${unit}` : ''
    const comparison = viteLink === 0 ? 'equal' : 'not comparable'
    return `| ${label} | ${format(viteLink)}${unitSuffix} | ${format(nestVanilla)}${unitSuffix} | ${comparison} |`
  }
  const delta = ((viteLink - nestVanilla) / nestVanilla) * 100
  if (stability?.equivalencePercent && Math.abs(delta) <= stability.equivalencePercent) {
    const unitSuffix = unit ? ` ${unit}` : ''
    return `| ${label} | ${format(viteLink)}${unitSuffix} | ${format(nestVanilla)}${unitSuffix} | parity (within ±${format(stability.equivalencePercent)}%) |`
  }
  const direction = delta === 0 ? 'equal' : delta > 0 === higherIsBetter ? 'better' : 'worse'
  const unitSuffix = unit ? ` ${unit}` : ''
  return `| ${label} | ${format(viteLink)}${unitSuffix} | ${format(nestVanilla)}${unitSuffix} | ${delta >= 0 ? '+' : ''}${format(delta)}% (${direction}) |`
}

function format(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(round(value))
}
