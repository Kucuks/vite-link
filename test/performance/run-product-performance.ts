import { execFileSync } from 'node:child_process'
import { availableParallelism, cpus, tmpdir, totalmem } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { build as viteBuild } from 'vite'
import { copyAssets } from '../../src/assets'
import { defineNestViteKitConfig } from '../../src/adapters/nest'
import { resolveViteKitConfig } from '../../src/config/defaults'
import { createViteInlineConfig } from '../../src/config/vite'
import { createTsconfigPathResolverPlugin } from '../../src/core/alias'
import { mapConcurrent } from '../../src/core/concurrency'
import { readTsconfig } from '../../src/core/tsconfig'
import { runDiagnostics } from '../../src/diagnostics'
import { RestartController } from '../../src/process'
import { measure, measureWithMemory, round, type Samples } from './statistics'

const SOURCE_FILE_COUNT = 2_000
const SOURCE_FILE_BYTES = 1_024
const BUILD_MODULE_COUNT = 500
const fixtureRoot = await mkdtemp(join(tmpdir(), 'vite-kit-performance-'))
const outputPath = readOutputPath()

try {
  await createFixture(fixtureRoot)
  const startedMemory = process.memoryUsage()
  const configResolution = await measure(20, async () => {
    await resolveNestConfig({ root: fixtureRoot, diagnostics: false })
  })

  const config = await resolveNestConfig({
    root: fixtureRoot,
    clearScreen: false,
    assets: [{ include: ['assets/**/*.txt'], base: 'assets', outDir: 'dist/assets' }],
    diagnostics: { strict: false, scanSource: true },
    typecheck: false,
  })

  const diagnostics = await measure(3, async () => {
    await runDiagnostics(config)
  })

  const assetCopy = await measure(3, async () => {
    await rm(join(fixtureRoot, 'dist/assets'), { recursive: true, force: true })
    const result = await copyAssets(config)
    if (result.copied !== SOURCE_FILE_COUNT) {
      throw new Error(`Expected ${SOURCE_FILE_COUNT} copied assets, received ${result.copied}`)
    }
  })

  const aliasResolution = await measureAliasResolution(fixtureRoot)
  const build = await measureWithMemory(10, async () => {
    await viteBuild({
      ...createViteInlineConfig(config),
      configFile: false,
      logLevel: 'silent',
    })
  })
  const restartBurst = await measureRestartBurst()
  const endedMemory = process.memoryUsage()

  const result = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    claimBoundary: 'Isolated local development-tool benchmark; not production capacity evidence.',
    targets: ['PF-01', 'PF-02', 'PF-07', 'PF-11', 'PF-12'],
    identity: {
      commit: readGitCommit(),
      dirty: readGitDirty(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      logicalCpuCount: availableParallelism?.() ?? cpus().length,
      totalMemoryBytes: totalmem(),
      sourceFileCount: SOURCE_FILE_COUNT,
      sourceFileBytes: SOURCE_FILE_BYTES,
      buildModuleCount: BUILD_MODULE_COUNT,
      workloadConcurrency: {
        fixtureWrites: 32,
        assetCopies: 16,
        diagnosticReads: 16,
        benchmarkOperations: 1,
      },
    },
    metrics: {
      configResolution,
      diagnostics,
      assetCopy,
      aliasResolution,
      build,
      restartBurst,
      wholeRunMemoryNotLeakEvidence: {
        rssDeltaBytes: endedMemory.rss - startedMemory.rss,
        heapUsedDeltaBytes: endedMemory.heapUsed - startedMemory.heapUsed,
        finalRssBytes: endedMemory.rss,
        finalHeapUsedBytes: endedMemory.heapUsed,
      },
    },
  }

  const json = `${JSON.stringify(result, null, 2)}\n`
  if (outputPath) {
    const absoluteOutput = resolve(outputPath)
    await mkdir(dirname(absoluteOutput), { recursive: true })
    await writeFile(absoluteOutput, json, 'utf8')
  }
  process.stdout.write(json)
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function createFixture(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'assets'), { recursive: true }),
  ])
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'commonjs', dependencies: { 'reflect-metadata': '^0.2.2' } }),
  )
  await writeFile(
    join(root, 'tsconfig.build.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        isolatedModules: true,
        baseUrl: '.',
        paths: { '@bench/*': ['src/*'] },
      },
    }),
  )
  await writeFile(
    join(root, 'src/main.ts'),
    [
      "import 'reflect-metadata'",
      "import { value } from './module-0000'",
      'const app = { enableShutdownHooks() {}, close() {} }',
      'app.enableShutdownHooks()',
      'console.log(value)',
    ].join('\n'),
  )

  await mapConcurrent(
    Array.from({ length: SOURCE_FILE_COUNT }, (_, index) => index),
    32,
    async (index) => {
      const suffix = String(index).padStart(4, '0')
      const next = String(index + 1).padStart(4, '0')
      const moduleText =
        index < BUILD_MODULE_COUNT - 1
          ? `import { value as next } from './module-${next}'\nexport const value = next + 1\n`
          : index < BUILD_MODULE_COUNT
            ? 'export const value = 1\n'
            : `export const value${suffix} = ${index}\n`
      await Promise.all([
        writeFile(join(root, `src/module-${suffix}.ts`), moduleText.padEnd(SOURCE_FILE_BYTES, ' ')),
        writeFile(join(root, `assets/asset-${suffix}.txt`), 'a'.repeat(SOURCE_FILE_BYTES)),
      ])
    },
  )
}

async function measureAliasResolution(root: string): Promise<{ cold: Samples; cached: Samples }> {
  const tsconfigPath = join(root, 'tsconfig.build.json')
  const tsconfig = await readTsconfig(tsconfigPath)
  const plugin = createTsconfigPathResolverPlugin(tsconfig.json, tsconfig.path)
  const hook = plugin.resolveId
  if (typeof hook !== 'function') throw new Error('Expected function resolveId hook')
  const importer = join(root, 'src/main.ts')
  const context = {} as never
  const options = { isEntry: false }

  const run = async () => {
    for (let index = 0; index < SOURCE_FILE_COUNT; index += 1) {
      const suffix = String(index).padStart(4, '0')
      const resolved = hook.call(context, `@bench/module-${suffix}`, importer, options)
      if (!resolved) throw new Error(`Alias did not resolve for module-${suffix}`)
    }
  }

  return { cold: await measure(1, run), cached: await measure(5, run) }
}

async function measureRestartBurst(): Promise<{
  scheduled: number
  executed: number
  elapsedMs: number
}> {
  let executed = 0
  const controller = new RestartController(10, async () => {
    executed += 1
  })
  const started = performance.now()
  for (let index = 0; index < 1_000; index += 1) controller.schedule()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 40))
  return { scheduled: 1_000, executed, elapsedMs: round(performance.now() - started) }
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function readOutputPath(): string | undefined {
  return readArgument('--output') ?? process.argv.slice(2).find((value) => !value.startsWith('-'))
}

async function resolveNestConfig(options: Parameters<typeof defineNestViteKitConfig>[0]) {
  return resolveViteKitConfig(defineNestViteKitConfig(options))
}

function readGitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function readGitDirty(): boolean | undefined {
  try {
    return Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    )
  } catch {
    return undefined
  }
}
