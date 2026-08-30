export function matchesPattern(value: string, patterns: Array<string | RegExp>): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return value === pattern || value.startsWith(`${pattern}/`)
    pattern.lastIndex = 0
    const matched = pattern.test(value)
    pattern.lastIndex = 0
    return matched
  })
}

export function normalizePatternList(
  patterns: Array<string | RegExp> | undefined,
): Array<string | RegExp> {
  return patterns ? [...patterns] : []
}
