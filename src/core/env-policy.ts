const SECRET_NAME_PATTERN =
  /(secret|token|password|passwd|pwd|private|key|credential|database_url|redis_url)/i

export function looksLikeSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name)
}
