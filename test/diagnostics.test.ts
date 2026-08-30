import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDiagnostics } from '../src/diagnostics'
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
})
