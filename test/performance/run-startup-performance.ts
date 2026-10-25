import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  createNestTypeScriptTransformPlugin,
  defineNestViteLinkConfig,
} from '../../src/adapters/nest'
import { resolveViteLinkConfig } from '../../src/config/defaults'
import { mapConcurrent } from '../../src/core/concurrency'
import { runDiagnostics } from '../../src/diagnostics'
import { summarize } from './statistics'

const root = await mkdtemp(join(tmpdir(), 'vite-link-startup-performance-'))
const count = 1_000
const repetitions = 7
const body = Array.from(
  { length: 60 },
  (_, i) => `export function f${i}(value: number) { return value + ${i} }`,
).join('\n')
const plain = `import { dependency } from './dependency'\n${body}\n`
const decorated =
  "import { Injectable } from '@nestjs/common'\n@Injectable()\nexport class Example { constructor(readonly value: String) {} }\n"

try {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  await writeFile(
    join(root, 'tsconfig.build.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        isolatedModules: true,
      },
    }),
  )
  await writeFile(join(root, 'src/main.ts'), 'export const main = true\n')
  await mapConcurrent(
    Array.from({ length: count }, (_, i) => i),
    16,
    async (i) => {
      const extra =
        i % 20 === 0
          ? '\nexport const load = (name: string) => import /* comment */ (name)\n'
          : i % 4 === 0
            ? "\nimport type { Dependency } from './dependency'\n"
            : ''
      await writeFile(join(root, `src/module-${i}.ts`), plain + extra)
    },
  )
  const config = await resolveViteLinkConfig(
    defineNestViteLinkConfig({
      root,
      diagnostics: { strict: false },
      typecheck: false,
    }),
  )
  const plugin = createNestTypeScriptTransformPlugin(config)
  const hook = plugin.transform
  if (typeof hook !== 'function') throw new Error('Expected transform hook')
  const metrics: Record<string, unknown> = {}
  const outcomes: Record<string, unknown> = {}
  const measure = async (name: string, operation: () => Promise<void>) => {
    await operation()
    const samples: number[] = []
    for (let i = 0; i < repetitions; i++) {
      const started = performance.now()
      await operation()
      samples.push(performance.now() - started)
    }
    metrics[name] = { ...summarize(samples), samplesMs: samples }
  }
  await measure('sourceDiagnostics', async () => {
    const diagnostics = await runDiagnostics(config)
    const codes = diagnostics.map((d) => d.code).sort()
    outcomes.diagnostics = codes.reduce<Record<string, number>>((map, code) => {
      map[code] = (map[code] ?? 0) + 1
      return map
    }, {})
    if (codes.length !== 50 || codes.some((code) => code !== 'DYNAMIC_IMPORT_NON_LITERAL')) {
      throw new Error('Diagnostic behavior changed')
    }
  })
  await measure('plainTransformHooks', async () => {
    for (let i = 0; i < count; i++) {
      if ((await hook.call({} as never, plain, join(root, `src/module-${i}.ts`))) !== null) {
        throw new Error('Plain source unexpectedly transformed')
      }
    }
  })
  await measure('decoratedTransformHooks', async () => {
    const digest = createHash('sha256')
    for (let i = 0; i < 100; i++) {
      const value = await hook.call({} as never, decorated, join(root, `src/service-${i}.ts`))
      if (!value || typeof value !== 'object' || !('code' in value))
        throw new Error('Missing transform')
      digest.update(typeof value.code === 'string' ? value.code : value.code.toString())
    }
    outcomes.decoratedCodeSha256 = digest.digest('hex')
  })
  const result = {
    recordedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    workload: {
      files: count + 1,
      functionsPerPlainFile: 60,
      repetitions,
      warmup: 1,
      fixtureSha256: createHash('sha256')
        .update(plain + decorated)
        .digest('hex'),
    },
    conditions:
      'Serial sub-stage benchmark in one process; filesystem cache retained. Excludes CLI process loading, bundling, typecheck, application startup and HTTP readiness.',
    metrics,
    outcomes,
  }
  const output = process.argv[2]
  if (output) await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
