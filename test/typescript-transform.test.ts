import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, type Plugin } from 'vite'
import nest from '../src/adapters/nest'
import { createNestTypeScriptTransformPlugin } from '../src/adapters/nest'
import { createFixture, resolveNestTestConfig as resolveNestViteConfig } from './helpers'

describe('Nest TypeScript transform', () => {
  it('runs when consumers invoke Vite directly instead of the managed CLI', async () => {
    const root = await createFixture()
    await writeFile(
      join(root, 'src/main.ts'),
      [
        "import { Injectable } from '@nestjs/common'",
        '',
        '@Injectable()',
        'export class ExampleService {',
        '  constructor(private readonly value: String) {}',
        '}',
      ].join('\n'),
    )

    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [nest({ root, diagnostics: false, typecheck: false })],
    })

    const output = await readFile(join(root, 'dist/main.cjs'), 'utf8')
    expect(output).toContain('__decorate')
    expect(output).toContain('__metadata')
    expect(output).not.toContain('@Injectable()')
  })

  it('lowers legacy decorators and emits decorator metadata before Rolldown sees the module', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const plugin = createNestTypeScriptTransformPlugin(config)
    const transformed = await callTransform(
      plugin,
      [
        "import { Injectable } from '@nestjs/common'",
        '',
        '@Injectable()',
        'export class ExampleService {',
        '  constructor(private readonly value: String) {}',
        '}',
      ].join('\n'),
      `${root}/src/example.service.ts`,
    )
    const code = getTransformedCode(transformed)

    expect(code).toContain('__decorate')
    expect(code).toContain('__metadata')
    expect(code).not.toContain('@Injectable()')
  })

  it('leaves undecorated non-entry modules to Vite and ignores at-signs inside strings', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const plugin = createNestTypeScriptTransformPlugin(config)
    const transformed = await callTransform(
      plugin,
      "export const supportEmail = 'support@example.com'\n",
      `${root}/src/support.ts`,
    )

    expect(transformed).toBeNull()
  })

  it('injects reflect-metadata before the Nest entry without changing app source', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const plugin = createNestTypeScriptTransformPlugin(config)
    const transformed = await callTransform(
      plugin,
      [
        "import { NestFactory } from '@nestjs/core'",
        "import { AppModule } from './app.module'",
        'export async function start() {',
        '  return NestFactory.create(AppModule)',
        '}',
      ].join('\n'),
      `${root}/src/main.ts`,
    )
    const code = getTransformedCode(transformed)

    expect(code.startsWith("import 'reflect-metadata';\n")).toBe(true)
  })

  it('does not duplicate an existing reflect-metadata import', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const plugin = createNestTypeScriptTransformPlugin(config)
    const transformed = await callTransform(
      plugin,
      [
        "import 'reflect-metadata'",
        "import { AppModule } from './app.module'",
        'export { AppModule }',
      ].join('\n'),
      `${root}/src/main.ts`,
    )
    const code = getTransformedCode(transformed)

    expect(code.match(/reflect-metadata/g)?.length).toBe(1)
  })

  it('prepends reflect-metadata when an existing import is after Nest imports', async () => {
    const root = await createFixture()
    const config = await resolveNestViteConfig({ root })
    const plugin = createNestTypeScriptTransformPlugin(config)
    const transformed = await callTransform(
      plugin,
      [
        "import { NestFactory } from '@nestjs/core'",
        "import 'reflect-metadata'",
        "import { AppModule } from './app.module'",
        'export async function start() {',
        '  return NestFactory.create(AppModule)',
        '}',
      ].join('\n'),
      `${root}/src/main.ts`,
    )
    const code = getTransformedCode(transformed)

    expect(code.startsWith("import 'reflect-metadata';\n")).toBe(true)
  })
})

async function callTransform(plugin: Plugin, code: string, id: string) {
  const hook = plugin.transform
  if (!hook) return null
  const handler = typeof hook === 'function' ? hook : hook.handler
  return handler.call({} as never, code, id)
}

function getTransformedCode(transformed: Awaited<ReturnType<typeof callTransform>>): string {
  if (!transformed || typeof transformed !== 'object' || !('code' in transformed)) return ''
  return typeof transformed.code === 'string' ? transformed.code : transformed.code.toString()
}
