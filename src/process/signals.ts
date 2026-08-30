export function bindProcessShutdown(stop: () => Promise<void> | void): void {
  let stopping = false

  const handler = async (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true

    try {
      await stop()
    } finally {
      process.kill(process.pid, signal)
    }
  }

  process.once('SIGINT', () => void handler('SIGINT'))
  process.once('SIGTERM', () => void handler('SIGTERM'))
}
