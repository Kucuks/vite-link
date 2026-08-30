import { describe, expect, it } from 'vitest'
import { summarize } from './statistics'

describe('performance statistics', () => {
  it('records explicit repetitions and warmups', () => {
    const values = [3, 1, 2]

    expect(summarize(values, 3, 2)).toEqual({
      repetitions: 3,
      warmupRepetitions: 2,
      minMs: 1,
      p50Ms: 2,
      p95Ms: 3,
      maxMs: 3,
      meanMs: 2,
      standardDeviationMs: 0.82,
      coefficientOfVariation: 0.41,
    })
    expect(values).toEqual([3, 1, 2])
  })
})
