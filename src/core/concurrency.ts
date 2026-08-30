export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive safe integer')
  }

  const results = Array.from<R>({ length: values.length })
  let nextIndex = 0

  const runWorker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await worker(values[index] as T, index)
    }
  }

  const workerCount = Math.min(concurrency, values.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

export class TaskQueue {
  private readonly pending: Array<() => void> = []
  private readonly idleResolvers = new Set<() => void>()
  private active = 0

  constructor(private readonly concurrency: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive safe integer')
    }
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push(() => {
        this.active += 1
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1
            this.drain()
          })
      })
      this.drain()
    })
  }

  async onIdle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0) return
    await new Promise<void>((resolve) => this.idleResolvers.add(resolve))
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const start = this.pending.shift()
      if (!start) break
      start()
    }
    if (this.active !== 0 || this.pending.length > 0) return
    for (const resolve of this.idleResolvers) resolve()
    this.idleResolvers.clear()
  }
}
