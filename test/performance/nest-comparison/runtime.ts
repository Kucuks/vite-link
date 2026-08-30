import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'
import { summarize } from '../statistics'
import { runCommandCapture } from './command'
import type { CommandSpec, Comparison, HttpRound, HttpSamples } from './types'

export async function measureStartup(spec: CommandSpec): Promise<number> {
  const port = await allocatePort()
  const started = performance.now()
  const app = spawnApplication(spec, port)
  try {
    await waitForHealth(app, port, 30_000)
    return performance.now() - started
  } finally {
    await stopApplication(app.child)
  }
}

export async function measureHttpComparison(
  commands: Comparison<CommandSpec>,
  loadGenerator: CommandSpec,
  options: {
    rounds: number
    durationSeconds: number
    connections: number
    warmupSeconds: number
  },
): Promise<Comparison<HttpSamples>> {
  const values = {
    viteLink: createHttpValues(),
    nestVanilla: createHttpValues(),
  }
  for (let roundIndex = 0; roundIndex < options.rounds; roundIndex += 1) {
    const order =
      roundIndex % 2 === 0
        ? (['viteLink', 'nestVanilla'] as const)
        : (['nestVanilla', 'viteLink'] as const)
    for (const variant of order) {
      const port = await allocatePort()
      const app = spawnApplication(commands[variant], port)
      try {
        await waitForHealth(app, port, 30_000)
        const sample = await runLoadGenerator(loadGenerator, port, options)
        values[variant].throughput.push(sample.requests.average)
        values[variant].averageLatency.push(sample.latency.average)
        values[variant].latencyP97_5.push(sample.latency.p97_5)
        values[variant].totalRequests += sample.requests.total
        const failures =
          sample.errors + sample.timeouts + sample.non2xx + sample.mismatches + sample.resets
        values[variant].failures += failures
        values[variant].rounds.push({
          requestsPerSecond: sample.requests.average,
          averageLatencyMs: sample.latency.average,
          latencyP97_5Ms: sample.latency.p97_5,
          totalRequests: sample.requests.total,
          failures,
        })
      } finally {
        await stopApplication(app.child)
      }
    }
  }
  const summarizeVariant = (variant: keyof typeof values): HttpSamples => ({
    throughputRequestsPerSecond: summarize(
      values[variant].throughput,
      options.rounds,
      options.rounds,
    ),
    averageLatencyMs: summarize(values[variant].averageLatency, options.rounds, options.rounds),
    latencyP97_5Ms: summarize(values[variant].latencyP97_5, options.rounds, options.rounds),
    totalRequests: values[variant].totalRequests,
    failures: values[variant].failures,
    rounds: values[variant].rounds,
  })
  return {
    viteLink: summarizeVariant('viteLink'),
    nestVanilla: summarizeVariant('nestVanilla'),
  }
}

function createHttpValues() {
  return {
    throughput: [] as number[],
    averageLatency: [] as number[],
    latencyP97_5: [] as number[],
    totalRequests: 0,
    failures: 0,
    rounds: [] as HttpRound[],
  }
}

async function runLoadGenerator(
  spec: CommandSpec,
  port: number,
  options: { durationSeconds: number; connections: number; warmupSeconds: number },
): Promise<AutocannonResult> {
  const output = await runCommandCapture({
    ...spec,
    args: [
      ...spec.args,
      '--connections',
      String(options.connections),
      '--duration',
      String(options.durationSeconds),
      '--warmup',
      '[',
      '--connections',
      String(options.connections),
      '--duration',
      String(options.warmupSeconds),
      ']',
      '--json',
      `http://127.0.0.1:${port}/health`,
    ],
  })
  const lines = output.trim().split(/\r?\n/)
  let jsonLine: string | undefined
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim().startsWith('{')) {
      jsonLine = lines[index]
      break
    }
  }
  if (!jsonLine) throw new Error(`Autocannon did not produce JSON: ${output}`)
  const result = JSON.parse(jsonLine) as AutocannonResult
  const failures =
    result.errors + result.timeouts + result.non2xx + result.mismatches + result.resets
  if (failures > 0) throw new Error(`Autocannon reported ${failures} failed requests`)
  return result
}

interface AutocannonResult {
  errors: number
  timeouts: number
  non2xx: number
  mismatches: number
  resets: number
  latency: { average: number; p97_5: number }
  requests: { average: number; total: number }
}

export interface RunningApplication {
  child: ChildProcess
  output: () => string
}

export function spawnApplication(
  spec: CommandSpec,
  port: number,
  options: { processTree?: boolean; nodeEnv?: string } = {},
): RunningApplication {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), NODE_ENV: options.nodeEnv ?? 'production' },
    detached: options.processTree === true && process.platform !== 'win32',
  })
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { child, output: () => output }
}

export async function waitForHealth(
  app: RunningApplication,
  port: number,
  timeoutMs: number,
  expectedRevision?: string,
): Promise<void> {
  const started = performance.now()
  let lastError: unknown
  while (performance.now() - started < timeoutMs) {
    if (app.child.exitCode !== null) {
      throw new Error(`Application exited with code ${app.child.exitCode}: ${app.output().trim()}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        if (expectedRevision === undefined) return
        const body = (await response.json()) as { revision?: string }
        if (body.revision === expectedRevision) return
        lastError = new Error(
          `Expected health revision ${expectedRevision}, received ${String(body.revision)}`,
        )
      } else {
        lastError = new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  const detail = app.output().trim() || String(lastError ?? 'no process output')
  throw new Error(`Timed out waiting for /health: ${detail}`)
}

export async function stopApplication(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  try {
    await waitForExit(child, 5_000)
  } catch {
    child.kill('SIGKILL')
    await waitForExit(child, 5_000).catch(() => {})
  }
}

export async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', () => resolvePromise())
      killer.once('exit', () => resolvePromise())
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  await waitForExit(child, 5_000).catch(async () => {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGKILL')
    }
    await waitForExit(child, 5_000).catch(() => {})
  })
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for process exit')),
      timeoutMs,
    )
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

export async function allocatePort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a loopback port'))
        return
      }
      server.close((error) => (error ? reject(error) : resolvePromise(address.port)))
    })
  })
}
