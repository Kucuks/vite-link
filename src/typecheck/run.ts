import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { ResolvedViteKitConfig } from '../types'

interface CommandSpec {
  command: string
  args: string[]
  shell: boolean
}

export async function runTypecheck(config: ResolvedViteKitConfig): Promise<void> {
  const tsc = resolveTypeScriptCompiler(config.root)
  await runCommand(
    tsc.command,
    [...tsc.args, '-p', config.typecheck.tsconfig, '--noEmit'],
    config.root,
    {
      shell: tsc.shell,
    },
  )
}

export function startTypecheckWatcher(config: ResolvedViteKitConfig): ChildProcess | undefined {
  if (config.typecheck.dev !== 'async') return undefined

  const tsc = resolveTypeScriptCompiler(config.root)
  const child = spawn(
    tsc.command,
    [...tsc.args, '-p', config.typecheck.tsconfig, '--noEmit', '--watch', '--preserveWatchOutput'],
    {
      cwd: config.root,
      stdio: 'inherit',
      shell: tsc.shell,
      env: process.env,
    },
  )
  child.on('error', (error) =>
    console.error(`[vite-kit] typecheck watcher failed: ${error.message}`),
  )
  return child
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { shell?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: resolve(cwd),
      stdio: 'inherit',
      shell: options.shell ?? process.platform === 'win32',
      env: options.env ?? process.env,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}

export function resolveTypeScriptCompiler(root: string): CommandSpec {
  try {
    const req = createRequire(resolve(root, 'package.json'))
    return {
      command: process.execPath,
      args: [req.resolve('typescript/bin/tsc')],
      shell: false,
    }
  } catch {
    return {
      command: 'tsc',
      args: [],
      shell: process.platform === 'win32',
    }
  }
}
