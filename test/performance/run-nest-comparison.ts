import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, tmpdir, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  measureComparison,
  packCurrentPackage,
  readGitCommit,
  readGitDirty,
  runCommand,
  runTimed,
} from './nest-comparison/command'
import {
  measureDevEditComparison,
  measureDevStartupComparison,
} from './nest-comparison/development'
import {
  createApplication,
  createFixturePackage,
  installFixtureDependencies,
  readInstalledVersions,
} from './nest-comparison/fixture'
import { measureOutput } from './nest-comparison/output'
import { renderMarkdown } from './nest-comparison/report'
import { measureHttpComparison, measureStartup } from './nest-comparison/runtime'
import type {
  BenchmarkOptions,
  CommandSpec,
  Comparison,
  ComparisonResult,
} from './nest-comparison/types'

const options = readOptions()
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tempRoot = await mkdtemp(join(tmpdir(), 'vite-link-nest-comparison-'))
const fixtureRoot = join(tempRoot, 'fixture')
const viteAppRoot = join(fixtureRoot, 'vite-link-app')
const nestAppRoot = join(fixtureRoot, 'nest-vanilla-app')

try {
  await mkdir(fixtureRoot, { recursive: true })
  const tarball = await packCurrentPackage(repoRoot, tempRoot)
  await createFixturePackage(fixtureRoot, tarball)
  await installFixtureDependencies(fixtureRoot)
  await Promise.all([
    createApplication(viteAppRoot, 'viteLink', options.featureModules),
    createApplication(nestAppRoot, 'nestVanilla', options.featureModules),
  ])

  const commands = createCommands()
  const cleanBuildMs = await measureComparison(options.buildRepetitions, {
    viteLink: () => runTimed(commands.build.viteLink),
    nestVanilla: () => runTimed(commands.build.nestVanilla),
  })
  await Promise.all([runCommand(commands.build.viteLink), runCommand(commands.build.nestVanilla)])
  const output = {
    viteLink: await measureOutput(join(viteAppRoot, 'dist'), join(viteAppRoot, 'dist/main.cjs')),
    nestVanilla: await measureOutput(join(nestAppRoot, 'dist'), join(nestAppRoot, 'dist/main.js')),
  }
  const startupToHealthMs = await measureComparison(options.startupRepetitions, {
    viteLink: () => measureStartup(commands.start.viteLink),
    nestVanilla: () => measureStartup(commands.start.nestVanilla),
  })
  const httpParity = await measureHttpComparison(commands.start, commands.loadGenerator, {
    rounds: options.httpRounds,
    durationSeconds: options.httpDurationSeconds,
    connections: options.httpConnections,
    warmupSeconds: options.httpWarmupSeconds,
  })
  const appRoots = { viteLink: viteAppRoot, nestVanilla: nestAppRoot }
  const devStartupToHealthMs = await measureDevStartupComparison(
    commands.dev,
    appRoots,
    options.devStartupRepetitions,
  )
  const devEditToHealthMs = await measureDevEditComparison(
    commands.dev,
    appRoots,
    options.devEditRepetitions,
  )
  const result: ComparisonResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    claimBoundary:
      'Local matched-workload build and runtime-parity benchmark; not production capacity or scalability evidence.',
    methodology: {
      build:
        'Alternating clean-output production builds after one warmup per variant. Vite Link includes configured diagnostics, TypeScript no-emit checking and Vite bundling; vanilla Nest uses its default TypeScript compiler pipeline.',
      startup:
        'Fresh Node process until the first successful HTTP 200 response from /health, using a newly allocated loopback port for every repetition.',
      development:
        'Development cold start measures each watch command through its first successful /health response. Edit-to-health measures a health-value source write through rebuild, process restart and the revised HTTP response. Vite Link uses managed build-and-restart, not provider-level HMR. Vite Link readiness can precede completion of its configured asynchronous type check; Nest watch completes compiler checking before readiness, so this is developer-perceived readiness rather than equal type-check latency.',
      http: 'Autocannon loopback /health load against freshly started builds with fixed connections, an explicit warmup interval and alternating variant order. This is an informational runtime-parity sample, not a Vite Link server-capacity claim.',
    },
    identity: {
      commit: readGitCommit(repoRoot),
      dirty: readGitDirty(repoRoot),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      logicalCpuCount: availableParallelism?.() ?? cpus().length,
      totalMemoryBytes: totalmem(),
      packageVersions: await readInstalledVersions(fixtureRoot),
    },
    workload: {
      featureModules: options.featureModules,
      sourceFilesPerVariant: options.featureModules + 3,
      buildRepetitions: options.buildRepetitions,
      startupRepetitions: options.startupRepetitions,
      devStartupRepetitions: options.devStartupRepetitions,
      devEditRepetitions: options.devEditRepetitions,
      httpRounds: options.httpRounds,
      httpDurationSecondsPerRound: options.httpDurationSeconds,
      httpConnections: options.httpConnections,
      httpWarmupSecondsPerRound: options.httpWarmupSeconds,
    },
    metrics: {
      cleanBuildMs,
      startupToHealthMs,
      devStartupToHealthMs,
      devEditToHealthMs,
      output,
      httpParity,
    },
  }

  if (options.outputPath) {
    const absoluteOutput = resolve(repoRoot, options.outputPath)
    await mkdir(dirname(absoluteOutput), { recursive: true })
    await writeFile(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${renderMarkdown(result)}\n`)
} finally {
  if (process.env.VITE_LINK_KEEP_PERFORMANCE_FIXTURE === '1') {
    process.stderr.write(`[performance] kept fixture at ${tempRoot}\n`)
  } else {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function createCommands(): {
  build: Comparison<CommandSpec>
  start: Comparison<CommandSpec>
  dev: Comparison<CommandSpec>
  loadGenerator: CommandSpec
} {
  return {
    build: {
      viteLink: {
        command: process.execPath,
        args: [
          join(fixtureRoot, 'node_modules/vite-link/dist/cli/bin.js'),
          'build',
          '--root',
          viteAppRoot,
          '--config',
          'vite.config.mts',
        ],
        cwd: viteAppRoot,
      },
      nestVanilla: {
        command: process.execPath,
        args: [
          join(fixtureRoot, 'node_modules/@nestjs/cli/bin/nest.js'),
          'build',
          '--path',
          'tsconfig.build.json',
        ],
        cwd: nestAppRoot,
      },
    },
    start: {
      viteLink: {
        command: process.execPath,
        args: ['--enable-source-maps', 'dist/main.cjs'],
        cwd: viteAppRoot,
      },
      nestVanilla: {
        command: process.execPath,
        args: ['--enable-source-maps', 'dist/main.js'],
        cwd: nestAppRoot,
      },
    },
    dev: {
      viteLink: {
        command: process.execPath,
        args: [
          join(fixtureRoot, 'node_modules/vite-link/dist/cli/bin.js'),
          'dev',
          '--root',
          viteAppRoot,
          '--config',
          'vite.config.mts',
        ],
        cwd: viteAppRoot,
      },
      nestVanilla: {
        command: process.execPath,
        args: [
          join(fixtureRoot, 'node_modules/@nestjs/cli/bin/nest.js'),
          'start',
          '--watch',
          '--path',
          'tsconfig.build.json',
        ],
        cwd: nestAppRoot,
      },
    },
    loadGenerator: {
      command: process.execPath,
      args: [join(fixtureRoot, 'node_modules/autocannon/autocannon.js')],
      cwd: fixtureRoot,
    },
  }
}

function readOptions(): BenchmarkOptions {
  return {
    featureModules: readPositiveInteger('--feature-modules', 100),
    buildRepetitions: readPositiveInteger('--build-repetitions', 7),
    startupRepetitions: readPositiveInteger('--startup-repetitions', 10),
    devStartupRepetitions: readPositiveInteger('--dev-startup-repetitions', 5),
    devEditRepetitions: readPositiveInteger('--dev-edit-repetitions', 7),
    httpRounds: readPositiveInteger('--http-rounds', 3),
    httpDurationSeconds: readPositiveInteger('--http-duration', 5),
    httpConnections: readPositiveInteger('--http-connections', 20),
    httpWarmupSeconds: readPositiveInteger('--http-warmup-duration', 3),
    outputPath:
      readArgument('--output') ?? process.argv.slice(2).find((value) => !value.startsWith('-')),
  }
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readArgument(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}
