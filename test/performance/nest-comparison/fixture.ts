import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './command'
import type { Variant } from './types'

export async function createFixturePackage(root: string, tarball: string): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vite-link-nest-comparison-fixture',
        private: true,
        type: 'commonjs',
        dependencies: {
          '@nestjs/common': '11.2.3',
          '@nestjs/core': '11.2.3',
          '@nestjs/platform-fastify': '11.2.3',
          'reflect-metadata': '0.2.2',
          rxjs: '7.8.2',
          'vite-link': `file:${tarball.replaceAll('\\', '/')}`,
        },
        devDependencies: {
          '@nestjs/cli': '11.0.24',
          '@types/node': '22.15.30',
          autocannon: '8.0.0',
          typescript: '6.0.3',
          vite: '8.2.2',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

export async function installFixtureDependencies(root: string): Promise<void> {
  await runCommand({
    command: 'npm',
    args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    cwd: root,
  })
}

export async function createApplication(
  root: string,
  variant: Variant,
  featureModules: number,
): Promise<void> {
  const sourceRoot = join(root, 'src')
  await mkdir(sourceRoot, { recursive: true })
  await Promise.all(
    Array.from({ length: featureModules }, (_, index) =>
      writeFile(
        join(sourceRoot, `feature-${suffix(index)}.ts`),
        createFeatureSource(index),
        'utf8',
      ),
    ),
  )
  await Promise.all([
    writeFile(join(sourceRoot, 'app.module.ts'), createAppModuleSource(featureModules), 'utf8'),
    writeFile(join(sourceRoot, 'main.ts'), createMainSource(variant), 'utf8'),
    writeFile(
      join(sourceRoot, 'health-value.ts'),
      createHealthRevisionSource('revision-0'),
      'utf8',
    ),
    writeFile(join(root, 'tsconfig.build.json'), createTsconfig(variant), 'utf8'),
  ])

  if (variant === 'viteLink') {
    await writeFile(join(root, 'vite.config.mts'), createViteConfig(), 'utf8')
  } else {
    await writeFile(
      join(root, 'nest-cli.json'),
      `${JSON.stringify(
        { sourceRoot: 'src', compilerOptions: { deleteOutDir: true } },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
}

export async function readInstalledVersions(root: string): Promise<Record<string, string>> {
  const names = [
    'vite-link',
    '@nestjs/cli',
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/platform-fastify',
    'autocannon',
    'typescript',
    'vite',
  ]
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const metadata = JSON.parse(
          await readFile(join(root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'),
        ) as { version: string }
        return [name, metadata.version]
      }),
    ),
  )
}

export function createHealthRevisionSource(revision: string): string {
  return `export const healthRevision = ${JSON.stringify(revision)}\n`
}

function createFeatureSource(index: number): string {
  const id = suffix(index)
  return [
    "import { Controller, Get, Injectable, Module } from '@nestjs/common'",
    '',
    '@Injectable()',
    `export class Feature${id}Service {`,
    `  value() { return ${index} }`,
    '}',
    '',
    `@Controller('/feature-${id}')`,
    `export class Feature${id}Controller {`,
    `  constructor(private readonly service: Feature${id}Service) {}`,
    '',
    '  @Get()',
    '  read() { return { value: this.service.value() } }',
    '}',
    '',
    '@Module({',
    `  controllers: [Feature${id}Controller],`,
    `  providers: [Feature${id}Service],`,
    '})',
    `export class Feature${id}Module {}`,
    '',
  ].join('\n')
}

function createAppModuleSource(featureModules: number): string {
  const imports = Array.from(
    { length: featureModules },
    (_, index) => `import { Feature${suffix(index)}Module } from './feature-${suffix(index)}'`,
  )
  const modules = Array.from(
    { length: featureModules },
    (_, index) => `    Feature${suffix(index)}Module,`,
  )
  return [
    "import { Controller, Get, Module } from '@nestjs/common'",
    "import { healthRevision } from './health-value'",
    ...imports,
    '',
    '@Controller()',
    'class HealthController {',
    "  @Get('/health')",
    "  health() { return { ok: true, source: 'nest-comparison', revision: healthRevision } }",
    '}',
    '',
    '@Module({',
    '  controllers: [HealthController],',
    '  imports: [',
    ...modules,
    '  ],',
    '})',
    'export class AppModule {}',
    '',
  ].join('\n')
}

function createMainSource(variant: Variant): string {
  const runtimeImport =
    variant === 'viteLink' ? "import { runManagedBootstrap } from 'vite-link/runtime'" : null
  return [
    "import 'reflect-metadata'",
    "import { NestFactory } from '@nestjs/core'",
    "import { FastifyAdapter } from '@nestjs/platform-fastify'",
    "import { AppModule } from './app.module'",
    runtimeImport,
    '',
    'export async function start() {',
    '  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false })',
    '  app.enableShutdownHooks()',
    "  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1')",
    '  return app',
    '}',
    '',
    variant === 'viteLink' ? 'void runManagedBootstrap(start)' : 'void start()',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function createTsconfig(variant: Variant): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: variant === 'viteLink' ? 'ESNext' : 'CommonJS',
        moduleResolution: variant === 'viteLink' ? 'Bundler' : 'Node',
        ignoreDeprecations: '6.0',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        isolatedModules: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        incremental: false,
        sourceMap: true,
        rootDir: 'src',
        outDir: 'dist',
      },
      include: ['src/**/*.ts'],
    },
    null,
    2,
  )}\n`
}

function createViteConfig(): string {
  return [
    "import { defineConfig } from 'vite'",
    "import nest from 'vite-link/nest'",
    '',
    'export default defineConfig({',
    '  plugins: [',
    '    nest({',
    "      entry: 'src/main.ts',",
    "      build: { format: 'cjs', outDir: 'dist' },",
    "      typecheck: { dev: 'async', build: 'before' },",
    '      diagnostics: { enabled: true, strict: false },',
    '    }),',
    '  ],',
    '})',
    '',
  ].join('\n')
}

function suffix(index: number): string {
  return String(index).padStart(3, '0')
}
