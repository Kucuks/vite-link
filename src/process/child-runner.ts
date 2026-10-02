import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import pc from 'picocolors'
import { loadEnv } from 'vite'
import type { ResolvedViteLinkConfig } from '../types'
import {
  isViteLinkProcessMessage,
  VITE_LINK_RUNTIME_READY,
  VITE_LINK_SHUTDOWN_REQUEST,
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
  private closed = false
  private startup: Promise<void> | undefined
  private completeStartup: ((error?: Error) => void) | undefined

  constructor(
    private readonly config: ResolvedViteLinkConfig,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  get currentPid(): number | undefined {
    return this.child?.pid
  }

  get applicationReady(): Promise<void> {
    return this.startup ?? Promise.reject(new Error('The application process has not started'))
  }

  async restart(): Promise<void> {
    if (this.closed) return
    await this.stop()
    if (!this.closed) this.start()
  }

  start(): void {
    if (this.closed) throw new Error('The application runner is closed')
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
      VITE_LINK_MANAGED: '1',
    }

    const child = spawn(process.execPath, [...this.config.dev.nodeArgs, entry], {
      cwd: this.config.root,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env,
    })

    this.child = child
    this.runtimeManaged = false
    let resolveStartup!: () => void
    let rejectStartup!: (error: Error) => void
    let startupSettled = false
    this.startup = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveStartup = resolvePromise
      rejectStartup = rejectPromise
    })
    // A caller may only need the legacy spawn-ready signal. Keep failures handled until
    // applicationReady is explicitly observed.
    void this.startup.catch(() => {})
    const completeStartup = (error?: Error) => {
      if (startupSettled) return
      startupSettled = true
      if (this.completeStartup === completeStartup) this.completeStartup = undefined
      if (error) rejectStartup(error)
      else resolveStartup()
    }
    this.completeStartup = completeStartup
    console.log(pc.dim(`[vite-link] app started with pid ${child.pid ?? 'unknown'}`))

    child.on('message', (message) => {
      if (
        this.child === child &&
        isViteLinkProcessMessage(message) &&
        message.type === VITE_LINK_RUNTIME_READY
      ) {
        this.runtimeManaged = true
        completeStartup()
      }
    })

    child.once('error', (error) => {
      if (this.child === child) {
        this.child = undefined
        this.runtimeManaged = false
      }
      completeStartup(error)
      this.onError(error)
    })

    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = undefined
        this.runtimeManaged = false
      }
      if (!startupSettled) {
        const error = new Error(
          `Application exited before reporting readiness (code=${code ?? 'null'}, signal=${signal ?? 'null'}). Check startup errors and whether PORT=${port} is already in use. Use runManagedBootstrap to report successful startup.`,
        )
        completeStartup(error)
        if (code !== 0 && !this.closed) this.onError(error)
      }
      console.log(
        pc.dim(`[vite-link] app exited code=${code ?? 'null'} signal=${signal ?? 'null'}`),
      )
    })
  }

  async close(): Promise<void> {
    this.closed = true
    await this.stop()
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping
    if (!this.child) return

    const child = this.child
    const runtimeManaged = this.runtimeManaged
    this.child = undefined
    this.runtimeManaged = false
    this.completeStartup?.(new Error('Application stopped before reporting readiness'))

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
        child.send({ type: VITE_LINK_SHUTDOWN_REQUEST }, (error) => {
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
