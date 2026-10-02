import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as fileSystem from '../src/core/fs'
import { runNestConfigDiagnostics } from '../src/adapters/nest/diagnostics'
import { runDiagnostics } from '../src/diagnostics'
import { createViteInlineConfig } from '../src/config/vite'
import { createFixture, resolveNestTestConfig as resolveNestViteConfig } from './helpers'

describe('diagnostics', () => {
  it('passes the healthy fixture', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig(
      { root, diagnostics: { strict: true } },
      'production',
    )
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.filter((item) => item.severity === 'fatal')).toEqual([])
  })

  it('does not warn when reflect-metadata is missing because the transform injects it', async () => {
    const root = await createFixture()
    await writeFile(join(root, 'src/main.ts'), "import { NestFactory } from '@nestjs/core'\n")
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'REFLECT_METADATA_MISSING')).toBe(false)
  })

  it('finds shutdown hooks in a bootstrap module imported by the entry', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/main.ts'),
      ["import { bootstrap } from './bootstrap'", '', 'void bootstrap()'].join('\n'),
    )
    await writeFile(
      join(root, 'src/bootstrap.ts'),
      [
        'export async function bootstrap() {',
        '  const app = { enableShutdownHooks() {} }',
        '  app.enableShutdownHooks()',
        '}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig(
      { root, diagnostics: { strict: true } },
      'production',
    )
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'NEST_SHUTDOWN_HOOKS_RECOMMENDED')).toBe(false)
  })

  it('bounds concurrent Nest shutdown-hook source reads', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig(
      { root, diagnostics: { strict: true, scanSource: false } },
      'production',
    )
    for (let index = 0; index < 32; index += 1) {
      await writeFile(join(root, 'src', `source-${index}.ts`), 'export const value = 1\n')
    }

    let activeReads = 0
    let peakReads = 0
    const read = vi.spyOn(fileSystem, 'readText').mockImplementation(async () => {
      activeReads += 1
      peakReads = Math.max(peakReads, activeReads)
      await new Promise((resolve) => setTimeout(resolve, 2))
      activeReads -= 1
      return ''
    })
    try {
      const diagnostics = await runNestConfigDiagnostics(config)
      expect(diagnostics.some((item) => item.code === 'NEST_SHUTDOWN_HOOKS_RECOMMENDED')).toBe(true)
      expect(peakReads).toBeGreaterThan(1)
      expect(peakReads).toBeLessThanOrEqual(16)
    } finally {
      read.mockRestore()
    }
  })

  it('does not warn for unrelated type-only imports in injectable classes', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/auth.guard.ts'),
      [
        "import { Injectable } from '@nestjs/common'",
        "import { ConfigService } from '@nestjs/config'",
        "import type { LaflaRequest } from './request.types'",
        '',
        '@Injectable()',
        'export class AuthGuard {',
        '  constructor(private readonly configService: ConfigService) {}',
        '  getRequest(): LaflaRequest | undefined {',
        '    return undefined',
        '  }',
        '}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'NEST_TYPE_ONLY_INJECTION_RISK')).toBe(false)
  })

  it('warns when an injected constructor type is imported type-only', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/auth.guard.ts'),
      [
        "import { Injectable } from '@nestjs/common'",
        "import type { ConfigService } from '@nestjs/config'",
        '',
        '@Injectable()',
        'export class AuthGuard {',
        '  constructor(private readonly configService: ConfigService) {}',
        '}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'NEST_TYPE_ONLY_INJECTION_RISK')).toBe(true)
  })

  it('does not treat constructors in undecorated domain classes as Nest injection', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/domain-error.ts'),
      [
        "import type { ApiEnvelope } from './api-envelope'",
        '',
        'export class DomainError extends Error {',
        '  constructor(readonly response: ApiEnvelope) {',
        "    super('domain error')",
        '  }',
        '}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'NEST_TYPE_ONLY_INJECTION_RISK')).toBe(false)
  })

  it('does not warn when a type-only injection uses an explicit Inject decorator', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/canvas.service.ts'),
      [
        "import { Injectable } from '@nestjs/common'",
        "import { InjectModel } from '@nestjs/mongoose'",
        "import type { Model } from 'mongoose'",
        '',
        'class Canvas {}',
        '',
        '@Injectable()',
        'export class CanvasService {',
        '  constructor(@InjectModel(Canvas.name) private readonly canvasModel: Model<Canvas>) {}',
        '}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'NEST_TYPE_ONLY_INJECTION_RISK')).toBe(false)
  })

  it('does not warn for dynamic import text in comments', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/session.service.ts'),
      [
        "import { Injectable } from '@nestjs/common'",
        '',
        '/** Avoiding an import (Auth <-> AccountEmail) cycle. */',
        '@Injectable()',
        'export class SessionService {}',
      ].join('\n'),
    )
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'DYNAMIC_IMPORT_NON_LITERAL')).toBe(false)
  })

  it('blocks secret-like env variables from build-time inlining', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({
      root,
      env: { inline: ['NODE_ENV', 'DATABASE_URL'], forbidInlineSecrets: true },
    })
    const diagnostics = await runDiagnostics(config)

    expect(diagnostics.some((item) => item.code === 'ENV_INLINE_SECRET_BLOCKED')).toBe(true)
  })

  it('checks the effective Vite define map for entire-env and secret replacements', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config, {
      define: {
        'process.env': JSON.stringify({ PUBLIC_BUILD_ID: 'fake-public-value' }),
        'process.env.API_TOKEN': JSON.stringify('fake-secret-value'),
        __ENV_SNAPSHOT__: JSON.stringify({ nested: { SESSION_TOKEN: 'fake-secret-value' } }),
      },
    })

    expect(diagnostics.filter((item) => item.code === 'PROCESS_ENV_INLINED')).toHaveLength(1)
    expect(diagnostics.filter((item) => item.code === 'VITE_DEFINE_SECRET_INLINED')).toHaveLength(2)
    expect(diagnostics.filter((item) => item.severity === 'fatal')).toHaveLength(3)
    expect(JSON.stringify(diagnostics)).not.toContain('fake-secret-value')
  })

  it('allows safe explicit Vite define constants', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root }, 'production')
    const diagnostics = await runDiagnostics(config, {
      define: { 'process.env.NODE_ENV': 'process.env.NODE_ENV', __BUILD_ID__: '"fake-id"' },
    })

    expect(diagnostics.some((item) => item.code === 'PROCESS_ENV_INLINED')).toBe(false)
    expect(diagnostics.some((item) => item.code === 'VITE_DEFINE_SECRET_INLINED')).toBe(false)
  })

  it('loads only explicitly inlined keys from mode-specific env files', async () => {
    const root = await createFixture()
    await writeFile(join(root, '.env'), 'PUBLIC_BUILD_ID=base\nDATABASE_URL=fake-base-secret\n')
    await writeFile(
      join(root, '.env.production'),
      'PUBLIC_BUILD_ID=production\nDATABASE_URL=fake-production-secret\n',
    )
    const config = await resolveNestViteConfig(
      {
        root,
        env: { inline: ['PUBLIC_BUILD_ID', 'DATABASE_URL'], forbidInlineSecrets: true },
      },
      'production',
    )

    const viteConfig = createViteInlineConfig(config)
    expect(viteConfig.define?.['process.env.PUBLIC_BUILD_ID']).toBe('"production"')
    expect(viteConfig.define).not.toHaveProperty('process.env.DATABASE_URL')
    expect(JSON.stringify(viteConfig.define)).not.toContain('fake-production-secret')
  })

  it('gives an existing process environment value precedence over env files', async () => {
    const root = await createFixture()
    const key = 'VITE_LINK_TEST_PUBLIC_BUILD_ID'
    await writeFile(join(root, '.env.production'), `${key}=fake-file-value\n`)
    const previous = process.env[key]
    try {
      process.env[key] = 'fake-process-value'
      const config = await resolveNestViteConfig({ root, env: { inline: [key] } }, 'production')
      const viteConfig = createViteInlineConfig(config)
      expect(viteConfig.define?.[`process.env.${key}`]).toBe('"fake-process-value"')
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })
})
