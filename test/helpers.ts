import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineNestViteLinkConfig } from '../src/adapters/nest'
import { resolveViteLinkConfig } from '../src/config/defaults'
import type { ViteLinkOptions } from '../src/types'

export async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vite-link-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'commonjs', dependencies: { '@nestjs/core': '^11.0.0' } }, null, 2),
  )
  await writeFile(
    join(root, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          isolatedModules: true,
          baseUrl: '.',
          paths: {
            '@app/*': ['src/*'],
          },
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(root, 'src/main.ts'),
    [
      "import 'reflect-metadata'",
      "import { NestFactory } from '@nestjs/core'",
      "import { AppModule } from './app.module'",
      'export async function start() {',
      '  const app = await NestFactory.create(AppModule)',
      '  app.enableShutdownHooks()',
      '  await app.listen(3000)',
      '  return app',
      '}',
    ].join('\n'),
  )
  return root
}

export async function resolveNestTestConfig(
  options: ViteLinkOptions = {},
  mode: 'development' | 'production' | 'diagnostics' = 'development',
) {
  return resolveViteLinkConfig(defineNestViteLinkConfig(options), mode)
}
