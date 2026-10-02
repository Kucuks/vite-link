import { describe, expect, it, vi } from 'vitest'
import { RestartController } from '../src/process/restart-controller'

describe('RestartController close boundary', () => {
  it('cancels a flushed callback before its microtask begins', async () => {
    const restart = vi.fn(async () => {})
    const controller = new RestartController(0, restart)

    const flushing = controller.flush()
    const closing = controller.close()
    await Promise.all([flushing, closing])

    expect(restart).not.toHaveBeenCalled()
    await controller.flush()
    expect(restart).not.toHaveBeenCalled()
  })
})
