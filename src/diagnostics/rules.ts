import type { Diagnostic, ResolvedViteKitConfig } from '../types'
import { runConfigDiagnostics } from './config-rules'
import { runSourceDiagnostics } from './source-rules'

export async function runDiagnostics(config: ResolvedViteKitConfig): Promise<Diagnostic[]> {
  if (!config.diagnostics.enabled) return []

  const configResults = await Promise.all([
    runConfigDiagnostics(config),
    ...config.adapters.map(async (adapter) => adapter.configDiagnostics?.(config) ?? []),
  ])
  const diagnostics = configResults.flat()
  if (config.diagnostics.scanSource) diagnostics.push(...(await runSourceDiagnostics(config)))
  return diagnostics
}
