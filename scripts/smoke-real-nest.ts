import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tempRoot = await mkdtemp(join(tmpdir(), 'vite-link-smoke-'))
const projectRoot = join(tempRoot, 'app')
const port = 31_000 + Math.floor(Math.random() * 5_000)
const typescriptVersion = process.env.VITE_LINK_SMOKE_TYPESCRIPT ?? '6.0.3'
const viteVersion = process.env.VITE_LINK_SMOKE_VITE ?? '^8.0.0'

try {
  await run('npm', ['pack', '--pack-destination', tempRoot], repoRoot)
  const packageMetadata = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  const tarballName = `${String(packageMetadata.name).replace(/^@/, '').replace('/', '-')}-${packageMetadata.version}.tgz`
  const tarball = join(tempRoot, tarballName)

  await mkdir(join(projectRoot, 'src'), { recursive: true })
  await writeFile(
    join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'vite-link-real-nest-smoke',
        private: true,
        type: 'module',
        scripts: {
          build: 'vite-link build --strict',
          start: 'node --enable-source-maps dist/main.cjs',
        },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(projectRoot, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          isolatedModules: true,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(projectRoot, 'vite.config.ts'),
    [
      "import { defineConfig } from 'vite'",
      "import nest from 'vite-link/nest'",
      '',
      'export default defineConfig({',
      '  plugins: [',
      '    nest({',
      "      entry: 'src/main.ts',",
      "      build: { format: 'cjs', outDir: 'dist' },",
      "      typecheck: { dev: false, build: 'before' },",
      '      diagnostics: { enabled: true, strict: true },',
      '    }),',
      '  ],',
      '})',
    ].join('\n'),
  )
  await writeFile(
    join(projectRoot, 'src/app.service.ts'),
    [
      "import { Injectable } from '@nestjs/common'",
      '',
      '@Injectable()',
      'export class AppService {',
      '  health() {',
      "    return { ok: true, source: 'vite-link-smoke' }",
      '  }',
      '}',
    ].join('\n'),
  )
  await writeFile(
    join(projectRoot, 'src/app.controller.ts'),
    [
      "import { Controller, Get } from '@nestjs/common'",
      "import { AppService } from './app.service'",
      '',
      '@Controller()',
      'export class AppController {',
      '  constructor(private readonly appService: AppService) {}',
      '',
      "  @Get('/health')",
      '  health() {',
      '    return this.appService.health()',
      '  }',
      '}',
    ].join('\n'),
  )
  await writeFile(
    join(projectRoot, 'src/app.module.ts'),
    [
      "import { Module } from '@nestjs/common'",
      "import { AppController } from './app.controller'",
      "import { AppService } from './app.service'",
      '',
      '@Module({',
      '  controllers: [AppController],',
      '  providers: [AppService],',
      '})',
      'export class AppModule {}',
    ].join('\n'),
  )
  await writeFile(
    join(projectRoot, 'src/main.ts'),
    [
      "import 'reflect-metadata'",
      "import { NestFactory } from '@nestjs/core'",
      "import { FastifyAdapter } from '@nestjs/platform-fastify'",
      "import { AppModule } from './app.module'",
      "import { runManagedBootstrap } from 'vite-link/runtime'",
      '',
      'export async function createApp() {',
      '  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false })',
      '  app.enableShutdownHooks()',
      '  return app',
      '}',
      '',
      'export async function start() {',
      '  const app = await createApp()',
      "  console.log('[smoke-fixture] app created')",
      "  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1')",
      "  console.log('[smoke-fixture] listening')",
      '  return app',
      '}',
      '',
      "console.log(`[smoke-fixture] starting port=${process.env.PORT ?? '3000'}`)",
      'void runManagedBootstrap(start)',
    ].join('\n'),
  )

  await run(
    'npm',
    [
      'install',
      '--no-audit',
      tarball,
      '@nestjs/common@^11.1.27',
      '@nestjs/core@^11.1.27',
      '@nestjs/platform-fastify@^11.1.27',
      'reflect-metadata@^0.2.2',
      'rxjs@^7.8.2',
      `typescript@${typescriptVersion}`,
      `vite@${viteVersion}`,
      '@types/node@^22.15.30',
    ],
    projectRoot,
  )

  await run(
    process.execPath,
    [
      '-e',
      "const core = require('vite-link'); const nest = require('vite-link/nest'); const runtime = require('vite-link/runtime'); if (typeof core.default !== 'function' || typeof core.viteLink !== 'function' || typeof nest.default !== 'function' || typeof runtime.runManagedBootstrap !== 'function') process.exit(1)",
    ],
    projectRoot,
  )
  await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import viteLink, { viteLink as named } from 'vite-link'; if (typeof viteLink !== 'function' || viteLink !== named) process.exit(1)",
    ],
    projectRoot,
  )
  await run('npm', ['run', 'build'], projectRoot)
  await verifyServer(projectRoot, port, 'managed CLI build')

  await rm(join(projectRoot, 'dist'), { recursive: true, force: true })
  await run('npm', ['exec', '--', 'vite', 'build'], projectRoot)
  const directBuild = await readFile(join(projectRoot, 'dist/main.cjs'), 'utf8')
  if (!directBuild.includes('__decorate') || !directBuild.includes('__metadata')) {
    throw new Error('Direct Vite build did not run the Nest decorator adapter')
  }
  await verifyServer(projectRoot, port, 'direct Vite build')

  console.log(`[smoke] real Nest CLI/direct-build/start/HTTP checks passed on port ${port}`)
} finally {
  if (process.env.VITE_LINK_KEEP_SMOKE === '1') {
    console.log(`[smoke] kept fixture at ${tempRoot}`)
  } else {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function verifyServer(
  fixtureRoot: string,
  fixturePort: number,
  label: string,
): Promise<void> {
  const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.cjs'], {
    cwd: fixtureRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(fixturePort) },
  })
  console.log(`[smoke] starting ${label} fixture pid=${child.pid ?? 'unknown'} port=${fixturePort}`)

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  try {
    try {
      const response = await retryFetch(`http://127.0.0.1:${fixturePort}/health`, 60_000)
      const json = (await response.json()) as { ok?: boolean; source?: string }
      if (json.ok !== true || json.source !== 'vite-link-smoke') {
        throw new Error(`Unexpected /health response: ${JSON.stringify(json)}`)
      }
    } catch (error) {
      const detail = output.trim() || '(no child-process output)'
      throw new Error(`${label} server failed (exit=${child.exitCode ?? 'running'}):\n${detail}`, {
        cause: error,
      })
    }
  } finally {
    child.kill('SIGTERM')
    await waitForExit(child, 5_000).catch(() => child.kill('SIGKILL'))
  }
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const isWindowsNpm = process.platform === 'win32' && command === 'npm'
    const executable = isWindowsNpm ? process.execPath : command
    const executableArgs = isWindowsNpm
      ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args]
      : args
    const child = spawn(executable, executableArgs, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

async function retryFetch(url: string, timeoutMs: number): Promise<Response> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out fetching ${url}`)
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for child exit')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}
