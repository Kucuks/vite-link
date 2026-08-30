import { execFileSync, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { summarize, type Samples } from '../statistics'
import type { CommandSpec, Comparison, Variant } from './types'

export async function packCurrentPackage(repoRoot: string, targetRoot: string): Promise<string> {
  await runCommand({
    command: 'npm',
    args: ['pack', '--ignore-scripts', '--pack-destination', targetRoot],
    cwd: repoRoot,
  })
  const metadata = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    name: string
    version: string
  }
  return join(
    targetRoot,
    `${metadata.name.replace(/^@/, '').replace('/', '-')}-${metadata.version}.tgz`,
  )
}

export async function measureComparison(
  repetitions: number,
  operations: Comparison<() => Promise<number>>,
): Promise<Comparison<Samples>> {
  await operations.viteLink()
  await operations.nestVanilla()
  const values: Comparison<number[]> = { viteLink: [], nestVanilla: [] }
  for (let index = 0; index < repetitions; index += 1) {
    const order: Variant[] =
      index % 2 === 0 ? ['viteLink', 'nestVanilla'] : ['nestVanilla', 'viteLink']
    for (const variant of order) values[variant].push(await operations[variant]())
  }
  return {
    viteLink: summarize(values.viteLink, repetitions, 1),
    nestVanilla: summarize(values.nestVanilla, repetitions, 1),
  }
}

export async function runTimed(spec: CommandSpec): Promise<number> {
  const started = performance.now()
  await runCommand(spec)
  return performance.now() - started
}

export async function runCommand(spec: CommandSpec): Promise<void> {
  await runCommandCapture(spec)
}

export async function runCommandCapture(spec: CommandSpec): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const isWindowsNpm = process.platform === 'win32' && spec.command === 'npm'
    const command = isWindowsNpm ? process.execPath : spec.command
    const args = isWindowsNpm
      ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...spec.args]
      : spec.args
    const child = spawn(command, args, {
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(output)
      else reject(new Error(`${spec.command} ${spec.args.join(' ')} failed (${code}):\n${output}`))
    })
  })
}

export function readGitCommit(repoRoot: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

export function readGitDirty(repoRoot: string): boolean | undefined {
  try {
    return Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    )
  } catch {
    return undefined
  }
}
