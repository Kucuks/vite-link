# Writing adapters

An adapter adds framework-specific behavior without moving that behavior into Vite Link's core. The bundled Nest adapter is the reference implementation.

```ts
import type { ViteLinkAdapter } from 'vite-link'

export const customAdapter: ViteLinkAdapter = {
  name: 'custom-runtime',
  plugins: () => [{ name: 'custom-runtime:transform' }],
  configDiagnostics: () => [],
  sourceDiagnostics: () => [],
}
```

Use it with the core plugin:

```ts
import { defineConfig } from 'vite'
import viteLink from 'vite-link'
import { customAdapter } from './custom-adapter'

export default defineConfig({
  plugins: [viteLink({ adapters: [customAdapter] })],
})
```

## Contract

- `name` is required, non-empty, and unique in one configuration.
- `plugins(options)` may return Vite plugins for transforms or framework-owned setup.
- `configDiagnostics(config)` validates resolved project configuration.
- `sourceDiagnostics(context)` validates a parsed source file.
- Hooks may be synchronous or asynchronous.

The source diagnostic context shares the core's TypeScript parse, so adapters should use the provided `sourceFile` instead of parsing the same file again.

## Boundaries

An adapter should own only behavior required by its framework or runtime:

- compiler transforms that Vite cannot infer;
- framework dependency externalization or deduplication defaults;
- configuration checks with actionable diagnostics;
- source checks that prevent framework-specific runtime failures.

Build watching, process lifecycle, assets, metadata command execution, TypeScript paths, and general diagnostics belong to the core. An adapter should not create a second watcher or child-process manager.

Diagnostics should include a stable code, severity, concise message, and—when useful—a file and actionable hint. Avoid diagnostics that merely express style preferences.

## Testing an adapter

An adapter is expected to have:

1. unit coverage for its configuration and source diagnostics;
2. direct Vite build coverage for its transform plugins;
3. a packed-tarball smoke fixture using the real framework;
4. ESM and CommonJS consumer checks when both formats are supported.

The Nest smoke test in `scripts/smoke-real-nest.ts` demonstrates the full package-consumer path.
