import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { summarize, type Samples } from '../statistics'
import { measureComparison } from './command'
import { createHealthRevisionSource } from './fixture'
import {
  allocatePort,
  spawnApplication,
  stopProcessTree,
  waitForHealth,
  type RunningApplication,
} from './runtime'
import type { CommandSpec, Comparison, Variant } from './types'

export async function measureDevStartupComparison(
  commands: Comparison<CommandSpec>,
  appRoots: Comparison<string>,
  repetitions: number,
): Promise<Comparison<Samples>> {
  return measureComparison(repetitions, {
    viteLink: () => measureDevStartup(commands.viteLink, appRoots.viteLink),
    nestVanilla: () => measureDevStartup(commands.nestVanilla, appRoots.nestVanilla),
  })
}

export async function measureDevEditComparison(
  commands: Comparison<CommandSpec>,
  appRoots: Comparison<string>,
  repetitions: number,
): Promise<Comparison<Samples>> {
  const ports = { viteLink: await allocatePort(), nestVanilla: await allocatePort() }
  const apps = {
    viteLink: spawnDevApplication(commands.viteLink, ports.viteLink),
    nestVanilla: spawnDevApplication(commands.nestVanilla, ports.nestVanilla),
  }
  try {
    await Promise.all([
      waitForHealth(apps.viteLink, ports.viteLink, 60_000, 'revision-0'),
      waitForHealth(apps.nestVanilla, ports.nestVanilla, 60_000, 'revision-0'),
    ])
    await updateAndWait('viteLink', 'warmup-vite-link', apps, ports, appRoots)
    await updateAndWait('nestVanilla', 'warmup-nest-vanilla', apps, ports, appRoots)

    const values: Comparison<number[]> = { viteLink: [], nestVanilla: [] }
    for (let index = 0; index < repetitions; index += 1) {
      const order: Variant[] =
        index % 2 === 0 ? ['viteLink', 'nestVanilla'] : ['nestVanilla', 'viteLink']
      for (const variant of order) {
        const revision = `revision-${index + 1}-${variant}`
        values[variant].push(await updateAndWait(variant, revision, apps, ports, appRoots))
      }
    }
    return {
      viteLink: summarize(values.viteLink, repetitions, 1),
      nestVanilla: summarize(values.nestVanilla, repetitions, 1),
    }
  } finally {
    await Promise.allSettled([
      stopProcessTree(apps.viteLink.child),
      stopProcessTree(apps.nestVanilla.child),
    ])
  }
}

async function measureDevStartup(spec: CommandSpec, appRoot: string): Promise<number> {
  const port = await allocatePort()
  await rm(join(appRoot, 'dist'), { recursive: true, force: true })
  const started = performance.now()
  const app = spawnDevApplication(spec, port)
  try {
    await waitForHealth(app, port, 60_000)
    return performance.now() - started
  } finally {
    await stopProcessTree(app.child)
  }
}

function spawnDevApplication(spec: CommandSpec, port: number): RunningApplication {
  return spawnApplication(spec, port, { processTree: true, nodeEnv: 'development' })
}

async function updateAndWait(
  variant: Variant,
  revision: string,
  apps: Comparison<RunningApplication>,
  ports: Comparison<number>,
  roots: Comparison<string>,
): Promise<number> {
  const started = performance.now()
  await writeFile(
    join(roots[variant], 'src/health-value.ts'),
    createHealthRevisionSource(revision),
    'utf8',
  )
  await waitForHealth(apps[variant], ports[variant], 60_000, revision)
  return performance.now() - started
}
