import { runMetadataGenerators } from '../../metadata'
import { createCliContext, type CliGlobalOptions } from '../context'

export async function metadataCommand(options: CliGlobalOptions): Promise<void> {
  const { config } = await createCliContext(options, 'build')
  await runMetadataGenerators(config)
}
