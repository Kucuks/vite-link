import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import pc from 'picocolors'
import { loadEnv } from 'vite'
import type { ResolvedViteKitConfig } from '../types'
import {
  isViteKitProcessMessage,
  VITE_KIT_RUNTIME_READY,
  VITE_KIT_SHUTDOWN_REQUEST,
} from './protocol'

function getNodeEnv(): string {
  return process.env.NODE_ENV && process.env.NODE_ENV !== 'production'
    ? process.env.NODE_ENV
    : 'development'
}

export class ChildRunner {
  private child: ChildProcess | undefined
  private stopping: Promise<void> | undefined
  private runtimeManaged = false

  constructor(
    private readonly config: ResolvedViteKitConfig,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  get currentPid(): number | undefined {
    return this.child?.pid
  }

  async restart(): Promise<void> {
    await this.stop()
    this.start()
  }

  start(): void {
    if (this.child) return

    const entry = resolve(
      this.config.root,
      this.config.build.outDir,
      this.config.build.entryFileName,
    )
    const dotenvEnv = loadEnv(this.config.mode, this.config.root, '')
    const nodeEnv = this.config.dev.env.NODE_ENV ?? dotenvEnv.NODE_ENV ?? getNodeEnv()
    const port =
      this.config.dev.env.PORT ?? process.env.PORT ?? dotenvEnv.PORT ?? String(this.config.dev.port)
    const env = {
      ...dotenvEnv,
      ...process.env,
      ...this.config.dev.env,
      NODE_ENV: nodeEnv,
      PORT: port,
    }

    const child = spawn(process.execPath, [...this.config.dev.nodeArgs, entry], {
      cwd: this.config.root,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env,
    })

    this.child = child
    this.runtimeManaged = false
    console.log(pc.dim(`[vite-kit] app started with pid ${child.pid ?? 'unknown'}`))

    child.on('message', (message) => {
      if (
        this.child === child &&
        isViteKitProcessMessage(message) &&
        message.type === VITE_KIT_RUNTIME_READY
      ) {
        this.runtimeManaged = true
      }
    })

    child.once('error', (error) => {
      if (this.child === child) {
        this.child = undefined
        this.runtimeManaged = false
      }
      this.onError(error)
    })

    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined
        this.runtimeManaged = false
      }
      console.log(pc.dim(`[vite-kit] app exited code=${code ?? 'null'} signal=${signal ?? 'null'}`))
    })
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping
    if (!this.child) return

    const child = this.child
    const runtimeManaged = this.runtimeManaged
    this.child = undefined
    this.runtimeManaged = false

    this.stopping = new Promise<void>((resolvePromise) => {
      let settled = false
      let exited = false

      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(forceTimer)
        this.stopping = undefined
        resolvePromise()
      }

      const forceTimer = setTimeout(() => {
        if (!exited && child.exitCode === null) {
          try {
            child.kill(this.config.dev.forceKillSignal)
          } catch (error) {
            this.onError(error)
            finish()
          }
        }
      }, this.config.dev.gracefulTimeout)

      child.once('exit', () => {
        exited = true
        finish()
      })
      child.once('error', finish)

      if (child.exitCode !== null) {
        exited = true
        finish()
        return
      }

      if (runtimeManaged && child.connected) {
        child.send({ type: VITE_KIT_SHUTDOWN_REQUEST }, (error) => {
          if (!error) return
          this.onError(error)
          sendKillSignal(child, this.config.dev.killSignal, this.onError)
        })
      } else {
        sendKillSignal(child, this.config.dev.killSignal, this.onError)
      }
    })

    return this.stopping
  }
}

function sendKillSignal(
  child: ChildProcess,
  signal: NodeJS.Signals,
  onError: (error: unknown) => void,
): void {
  try {
    child.kill(signal)
  } catch (error) {
    onError(error)
  }
}
