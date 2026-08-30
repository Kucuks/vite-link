export class RestartController {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private queued = false
  private closed = false

  constructor(
    private readonly debounce: number,
    private readonly restart: () => Promise<void>,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  schedule(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(this.onError)
    }, this.debounce)
  }

  async flush(): Promise<void> {
    if (this.closed) return
    if (this.running) {
      this.queued = true
      return
    }

    this.running = true
    try {
      await this.restart()
    } finally {
      this.running = false
      if (this.queued && !this.closed) {
        this.queued = false
        this.schedule()
      }
    }
  }

  close(): void {
    this.closed = true
    this.queued = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
