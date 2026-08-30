import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isViteKitProcessMessage,
  VITE_KIT_RUNTIME_READY,
  VITE_KIT_SHUTDOWN_REQUEST,
} from './process/protocol'

export interface ManagedApp {
  close?: () => Promise<unknown> | unknown
}

export type CreateOrStartApp<T extends ManagedApp = ManagedApp> = () => Promise<T> | T

export interface ManagedBootstrapOptions {
  onError?: (error: unknown) => void
}

export function filename(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl)
}

export function dir(importMetaUrl: string): string {
  return dirname(filename(importMetaUrl))
}

export async function disposeApp(app: ManagedApp | null | undefined): Promise<void> {
  if (!app?.close) return
  await app.close()
}

export async function runManagedBootstrap<T extends ManagedApp>(
  factory: CreateOrStartApp<T>,
  options: ManagedBootstrapOptions = {},
): Promise<T> {
  const onError = options.onError ?? console.error
  const startup = Promise.resolve().then(factory)
  let app: T | undefined
  let closing = false

  const shutdown = async (signal?: NodeJS.Signals) => {
    if (closing) return
    closing = true

    try {
      app ??= await startup
      await disposeApp(app)
    } catch (error) {
      process.exitCode = 1
      onError(error)
    } finally {
      if (signal) {
        process.kill(process.pid, signal)
      } else if (process.connected) {
        process.disconnect()
      }
    }
  }

  const onMessage = (message: unknown) => {
    if (isViteKitProcessMessage(message) && message.type === VITE_KIT_SHUTDOWN_REQUEST) {
      void shutdown()
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.on('message', onMessage)
  app = await startup
  if (!closing) process.send?.({ type: VITE_KIT_RUNTIME_READY })

  return app
}
