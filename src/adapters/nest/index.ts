import { viteKit } from '../../plugin'
import type { ViteKitAdapter, ViteKitOptions, ViteKitPluginOption } from '../../types'
import { runNestConfigDiagnostics, runNestSourceDiagnostics } from './diagnostics'
import { createNestTypeScriptTransformPlugin } from './typescript-transform'

const NEST_ALWAYS_EXTERNAL = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/microservices',
  '@nestjs/platform-express',
  '@nestjs/platform-fastify',
  '@nestjs/websockets',
  'reflect-metadata',
  'rxjs',
  'class-transformer',
  'class-validator',
]

const NEST_DEDUPE = ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs']

export const nestAdapter: ViteKitAdapter = {
  name: 'nest',
  plugins: (options) => [createNestTypeScriptTransformPlugin(options)],
  configDiagnostics: runNestConfigDiagnostics,
  sourceDiagnostics: runNestSourceDiagnostics,
}

export function defineNestViteKitConfig(options: ViteKitOptions = {}): ViteKitOptions {
  return {
    ...options,
    external: {
      ...options.external,
      alwaysExternal: [...NEST_ALWAYS_EXTERNAL, ...(options.external?.alwaysExternal ?? [])],
    },
    monorepo: {
      ...options.monorepo,
      dedupe: [...new Set([...NEST_DEDUPE, ...(options.monorepo?.dedupe ?? [])])],
    },
    adapters: [nestAdapter, ...(options.adapters ?? []).filter(({ name }) => name !== 'nest')],
  }
}

export function nest(options: ViteKitOptions = {}): ViteKitPluginOption {
  return viteKit(defineNestViteKitConfig(options))
}

export default nest
export { createNestTypeScriptTransformPlugin } from './typescript-transform'
