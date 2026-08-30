# Configuration reference

Vite Kit is configured inside `vite.config.ts`. All paths are resolved from `root`, which defaults to the current working directory.

```ts
import { defineConfig } from 'vite'
import viteKit from 'vite-kit'

export default defineConfig({
  plugins: [viteKit({ entry: 'src/main.ts' })],
})
```

## Project options

| Option          | Default                                     | Meaning                                |
| --------------- | ------------------------------------------- | -------------------------------------- |
| `root`          | `process.cwd()`                             | Project root                           |
| `entry`         | `src/main.ts`                               | Server entry file                      |
| `tsconfig`      | `tsconfig.build.json`, then `tsconfig.json` | TypeScript configuration               |
| `sourceRoot`    | inferred from the entry                     | Source-diagnostic boundary             |
| `clearScreen`   | `true`                                      | Clear console between lifecycle events |
| `tsconfigPaths` | `true`                                      | Resolve TypeScript path aliases        |
| `adapters`      | `[]`                                        | Framework or runtime adapters          |

## Build

`build.format: 'auto'` uses the package and TypeScript module settings. CommonJS is the conservative fallback.

| Option            | Default                              |
| ----------------- | ------------------------------------ |
| `outDir`          | `dist`                               |
| `emptyOutDir`     | `true`                               |
| `sourcemap`       | `true`                               |
| `minify`          | `false`                              |
| `target`          | `node20`                             |
| `format`          | `auto`                               |
| `entryFileName`   | `main.cjs` or `main.mjs`             |
| `chunkFileNames`  | `chunks/[name]-[hash].cjs` or `.mjs` |
| `preserveModules` | `false`                              |

Supported `minify` values are `false`, `oxc`, `esbuild`, and `terser`. Terser is optional in Vite and must be installed by the consuming project when selected.

The build output directory must resolve inside the project root. Vite Kit rejects parent-directory escapes and output paths that traverse a symlink outside the project before Vite can empty or write the directory.

## Development process

| Option            | Default                    | Meaning                                           |
| ----------------- | -------------------------- | ------------------------------------------------- |
| `strategy`        | `restart`                  | Managed development strategy                      |
| `port`            | `3000`                     | Exposed to the child as `PORT` unless already set |
| `debounce`        | `80` ms                    | Collapses rapid restart requests                  |
| `gracefulTimeout` | `5000` ms                  | Wait before force-killing the child               |
| `killSignal`      | `SIGTERM`                  | Normal fallback shutdown signal                   |
| `forceKillSignal` | `SIGKILL`                  | Signal after the graceful timeout                 |
| `nodeArgs`        | `['--enable-source-maps']` | Node arguments for the child                      |
| `env`             | `{}`                       | Explicit child-process environment values         |

`runManagedBootstrap` adds an IPC-aware shutdown handshake. Without it, the runner uses the configured signals and timeout.

## Type checking and diagnostics

Type checking defaults to asynchronous watch mode during development and blocking mode before production builds.

```ts
typecheck: { dev: 'async', build: 'before', tsconfig: 'tsconfig.build.json' }
```

Set `typecheck: false` to disable both. `dev` and `build` accept `false`; `dev` also accepts `async` or `before`.

Diagnostics are enabled by default. Production builds are strict by default and fail at the configured `failOn` threshold.

```ts
diagnostics: {
  enabled: true,
  strict: true,
  scanSource: true,
  failOn: 'error',
}
```

Severities are `info`, `warn`, `error`, and `fatal`.

## Assets

Each mapping declares what to copy and how a change affects the child process.

```ts
assets: [
  {
    include: ['src/views/**/*', 'src/**/*.graphql'],
    exclude: ['src/**/__fixtures__/**'],
    base: 'src',
    outDir: 'dist',
    restart: true,
  },
]
```

Vite Kit rejects output collisions, project-boundary escapes, and unsafe symlink targets. If `src/i18n` exists and is not already configured, it is copied relative to `src` without restarting the child.

## Dependencies and monorepos

Production dependencies and peer dependencies are external by default. Common native and database packages are always external unless explicitly overridden.

```ts
external: {
  dependencies: true,
  devDependencies: false,
  peerDependencies: true,
  include: [],
  exclude: [],
  alwaysExternal: [],
  noExternal: ['package-to-bundle'],
},
monorepo: {
  dedupe: ['a-runtime-singleton'],
}
```

Patterns accept strings or regular expressions. `noExternal` and `exclude` take precedence over external lists.

## Environment variables

Vite mode and environment-file precedence remain active. Vite Kit does not inline arbitrary environment variables.

```ts
env: {
  inline: ['PUBLIC_BUILD_ID'],
  keepRuntime: true,
  forbidInlineSecrets: true,
}
```

Secret-looking names are refused when `forbidInlineSecrets` is enabled. Runtime environment values and explicit `dev.env` values remain authoritative.

## Metadata commands

Vite Kit does not guess how a project generates OpenAPI, GraphQL, ORM, or other metadata. Commands are explicit and project-owned.

```ts
metadata: {
  enabled: true,
  commands: ['npm run generate:openapi'],
  watch: true,
}
```

Build commands run after output is emitted. Watched commands are serialized and debounced. Enabling metadata without a command is a diagnostic error.
