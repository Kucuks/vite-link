import pc from 'picocolors'

export interface Logger {
  info(message: string): void
  success(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
}

export function createLogger(scope = 'vite-link', verbose = false): Logger {
  const prefix = pc.dim(`[${scope}]`)
  return {
    info: (message) => console.log(`${prefix} ${message}`),
    success: (message) => console.log(`${prefix} ${pc.green(message)}`),
    warn: (message) => console.warn(`${prefix} ${pc.yellow(message)}`),
    error: (message) => console.error(`${prefix} ${pc.red(message)}`),
    debug: (message) => {
      if (verbose) console.log(`${prefix} ${pc.dim(message)}`)
    },
  }
}
