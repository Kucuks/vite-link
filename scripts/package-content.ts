/** Shared by packed-archive verification and platform regression fixtures. */
export function inspectPackedContent(path: string, content: string): string[] {
  const errors: string[] = []
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|[A-Za-z]:[\\/](?:Users|Projects)[\\/]|\/(?:home|Users)\/[^/\s]+\//.test(
      content,
    )
  ) {
    errors.push(`packed file contains a local build path or secret-like value: ${path}`)
  }
  if (path.endsWith('.map')) {
    const map = JSON.parse(content) as { sources?: string[]; sourceRoot?: string; file?: string }
    if (
      [...(map.sources ?? []), map.sourceRoot ?? '', map.file ?? ''].some((source) =>
        /^(?:\/|[A-Za-z]:[\\/]|file:)/.test(source),
      )
    ) {
      errors.push(`source map contains a builder-local absolute path: ${path}`)
    }
  }
  return errors
}
