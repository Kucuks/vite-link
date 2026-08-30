<h1 align="center">Vite Link</h1>

<p align="center">
  <strong>Predictable Vite/Rolldown builds and managed development lifecycles for Node.js backends.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vite-link"><img alt="npm version" src="https://img.shields.io/npm/v/vite-link?color=646cff"></a>
  <a href="https://www.npmjs.com/package/vite-link"><img alt="npm downloads" src="https://img.shields.io/npm/dw/vite-link?color=646cff"></a>
  <a href="https://github.com/Kucuks/vite-link/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Kucuks/vite-link/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js support" src="https://img.shields.io/badge/Node.js-%5E20.19%20%7C%7C%20%3E%3D22.12-339933?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <a href="#why-vite-link">Why Vite Link?</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

Vite is already an excellent build tool. A backend, however, also needs predictable Node output, dependency externalization, type checking, assets, diagnostics, and a child process that restarts without leaking application state. Vite Link brings those pieces together while keeping its core framework-neutral.

Nest is the first bundled adapter, exposed as `vite-link/nest`; it is not a core dependency or the boundary of the project.

> **Scope:** Vite Link improves the development and build pipeline. It is not an HTTP server, production process supervisor, cluster manager, or application-capacity benchmark.

## Highlights

|     | Capability            | Vite Link behavior                                                           |
| --- | --------------------- | ---------------------------------------------------------------------------- |
| ⚡  | Node builds           | Vite 8/Rolldown SSR builds with executable CommonJS or ESM output            |
| 🔁  | Development lifecycle | Build, start, gracefully stop, and restart a managed Node child process      |
| 🧩  | Framework adapters    | Optional transforms, defaults, and diagnostics outside the neutral core      |
| 🩺  | Early feedback        | Optional TypeScript checks and actionable configuration/source diagnostics   |
| 📦  | Backend pipelines     | Asset copying/watching, metadata commands, and dependency externalization    |
| 🔒  | Safety                | Bounded concurrency, restart backpressure, path checks, and symlink defenses |

## Why Vite Link?

Direct Vite usage remains available. Vite Link adds the backend-specific orchestration that would otherwise live in project-owned scripts and plugins.

| Requirement                | Direct Vite                | Vite Link                                              |
| -------------------------- | -------------------------- | ------------------------------------------------------ |
| Node SSR bundle            | Built in                   | Built in with backend-oriented output defaults         |
| Type checking              | Separate command or plugin | Optional blocking or asynchronous pipeline             |
| Dependency externalization | Project configuration      | Dependency-aware defaults with selective bundling      |
| Backend assets             | Project configuration      | Copy/watch mappings with collision and boundary checks |
| Child-process restart      | Project script             | Managed graceful restart with backpressure             |
| Framework transforms       | Project/plugin specific    | Explicit adapter contract; Nest bundled separately     |
| Backend diagnostics        | Project specific           | Core and adapter-owned configuration/source rules      |

Use Vite Link when a Node backend needs a repeatable build-and-restart boundary. Use Vite directly when a bundle is all you need. Keep production supervision with your deployment platform, container runtime, systemd, or another dedicated process manager.

## Compatibility

| Dependency | Supported                 | Release evidence                                                       |
| ---------- | ------------------------- | ---------------------------------------------------------------------- |
| Node.js    | `^20.19.0` or `>=22.12.0` | CI covers the minimums, Node 24, Windows, macOS, and Linux             |
| Vite       | `>=8.0.0 <9`              | Packed consumers cover `8.0.0` and `8.2.2`                             |
| TypeScript | `>=5.6.0 <7`              | Packed consumers cover `5.6.3`, `5.7.3`, `5.8.3`, `5.9.3`, and `6.0.3` |
| Modules    | CommonJS and ESM          | Both package entry points and built application output are verified    |

The `0.1.x` release line is pinned to Vite `8.2.2` and TypeScript `6.0.3`. TypeScript 7 is not supported yet because [its 7.0 release does not ship a programmatic compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), which adapter transforms and source diagnostics require.

## Quick start

For a new project, install Vite Link with its tested peer versions:

```bash
npm install --save-dev vite-link vite@^8.2.2 typescript@^6.0.3
```

An existing project can keep any Vite and TypeScript versions from the [supported ranges](#compatibility).

### Nest

In an existing Nest application, create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import nest from 'vite-link/nest'

export default defineConfig({
  plugins: [
    nest({
      entry: 'src/main.ts',
      build: { outDir: 'dist', format: 'cjs' },
      typecheck: { dev: 'async', build: 'before' },
      diagnostics: true,
    }),
  ],
})
```

Let Vite Link close the application before a restart. In `src/main.ts`:

```ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { runManagedBootstrap } from 'vite-link/runtime'
import { AppModule } from './app.module'

async function start() {
  const app = await NestFactory.create(AppModule)
  app.enableShutdownHooks()
  await app.listen(Number(process.env.PORT ?? 3000))
  return app
}

void runManagedBootstrap(start)
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "vite-link dev",
    "build": "vite-link build",
    "diagnostics": "vite-link diagnostics",
    "start": "node --enable-source-maps dist/main.cjs"
  }
}
```

Start development:

```bash
npm run dev
```

The first successful build starts the application. Initial build errors leave the watcher active, later build errors keep the last successful child running, and a successful rebuild gracefully replaces the child.

The Nest adapter lowers legacy decorators, emits configured decorator metadata, keeps Nest runtime packages external, and warns about unsafe type-only constructor injection. A complete consumer project is available in [`examples/basic-nest`](examples/basic-nest).

### Framework-neutral Node.js

The default export is the core plugin. Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import viteLink from 'vite-link'

export default defineConfig({
  plugins: [
    viteLink({
      entry: 'src/main.ts',
      build: { outDir: 'dist', format: 'esm' },
      typecheck: { dev: 'async', build: 'before' },
    }),
  ],
})
```

Return any object with a `close` method from the managed bootstrap factory:

```ts
import { createServer } from 'node:http'
import { runManagedBootstrap } from 'vite-link/runtime'

async function start() {
  const server = createServer((_request, response) => {
    response.end('Hello from Vite Link')
  })

  await new Promise<void>((resolve) => {
    server.listen(Number(process.env.PORT ?? 3000), resolve)
  })

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

void runManagedBootstrap(start)
```

Use `vite-link dev` during development and start the production build with `node --enable-source-maps dist/main.mjs`.

## How it works

Vite Link intentionally uses a build-and-restart process boundary instead of provider-level hot swapping:

```text
source change
    ↓
Vite/Rolldown build
    ├─ error   → keep the last successful child running
    └─ success → emit dist entry
                    ↓
             graceful child close
                    ↓
               Node restart
```

The managed runtime prefers an IPC shutdown handshake. Applications that do not use `runManagedBootstrap` receive the configured signal, followed by the force signal only after `gracefulTimeout`.

## Commands

| Command                 | What it does                                                            | Use it when                                           |
| ----------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `vite-link dev`         | Watches builds and configured assets/metadata; owns child restarts      | Running the backend locally                           |
| `vite-link build`       | Runs diagnostics, type checking, build validation, metadata, and assets | Producing release output                              |
| `vite-link diagnostics` | Reports configuration and source-level risks without building           | Auditing or debugging a project                       |
| `vite-link metadata`    | Runs only explicitly configured metadata commands                       | Regenerating OpenAPI, GraphQL, ORM, or similar output |

All commands accept `--root`, `--config`, `--mode`, and `--strict`.

Direct `vite build` also works and runs the Vite plugins and asset close hook. Prefer `vite-link build` when you want the complete managed diagnostics, type-check, metadata, validation, and asset pipeline.

## Configuration

Configuration stays in `vite.config.ts`; Vite Link does not introduce a second configuration format.

```ts
viteLink({
  entry: 'src/main.ts',
  tsconfig: 'tsconfig.build.json',
  build: { format: 'cjs', outDir: 'dist', sourcemap: true },
  dev: { debounce: 80, gracefulTimeout: 5_000 },
  assets: [{ include: 'src/views/**/*', base: 'src', restart: false }],
  external: { noExternal: ['a-package-that-must-be-bundled'] },
  metadata: { commands: ['npm run generate:openapi'], watch: true },
})
```

See the [configuration reference](docs/CONFIGURATION.md) for every option and default. The build output directory must remain inside the project root; parent escapes and symlink escapes are rejected before Vite can empty or write it.

## Public entry points

| Import              | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `vite-link`         | Core plugin, runtime helpers, configuration types, and adapter types |
| `vite-link/plugin`  | Explicit core-plugin entry point                                     |
| `vite-link/nest`    | Nest adapter and its TypeScript transform                            |
| `vite-link/runtime` | Managed bootstrap and ESM path helpers                               |

The supported public surface is limited to these entry points. Framework packages are never imported by the core.

### Common exports

| Export                                               | Entry point                      | Purpose                                                            |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `viteLink(options)`                                  | `vite-link`, `vite-link/plugin`  | Create the framework-neutral Vite plugin set                       |
| `defineViteLinkConfig(options)`                      | `vite-link`, `vite-link/plugin`  | Type a reusable Vite Link options object                           |
| `nest(options)`                                      | `vite-link/nest`                 | Create the core plugin with Nest defaults and transforms           |
| `defineNestViteLinkConfig(options)`                  | `vite-link/nest`                 | Apply Nest defaults without constructing plugins immediately       |
| `runManagedBootstrap(factory, options?)`             | `vite-link`, `vite-link/runtime` | Advertise IPC readiness and close application resources on restart |
| `disposeApp(app)`                                    | `vite-link`, `vite-link/runtime` | Close a managed object when it exposes a `close` method            |
| `filename(import.meta.url)` / `dir(import.meta.url)` | `vite-link`, `vite-link/runtime` | Resolve ESM file and directory paths                               |

## Guides and examples

| Resource                                         | Covers                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| [Basic Nest example](examples/basic-nest)        | Runnable Nest consumer configuration and bootstrap                    |
| [Configuration reference](docs/CONFIGURATION.md) | Options, defaults, assets, diagnostics, metadata, and externalization |
| [Architecture](docs/ARCHITECTURE.md)             | Build lifecycle, restart model, ownership, and safety boundaries      |
| [Writing adapters](docs/ADAPTERS.md)             | Adapter contract, boundaries, diagnostics, and testing expectations   |
| [Security policy](SECURITY.md)                   | Private vulnerability reporting and supported versions                |
| [Contributing guide](CONTRIBUTING.md)            | Repository setup, checks, and pull-request expectations               |

## Troubleshooting

<details>
<summary><strong>Why does npm reject TypeScript 7?</strong></summary>

Vite Link currently imports the TypeScript programmatic compiler API for transforms and diagnostics. TypeScript 7.0 does not provide that API, so the supported range intentionally ends below 7. Use TypeScript `6.0.3` for a new project or any tested release from `5.6.3` through `6.0.3`.

</details>

<details>
<summary><strong>Why is <code>dist/main.cjs</code> or <code>dist/main.mjs</code> missing?</strong></summary>

The emitted extension follows `build.format`. CommonJS produces `main.cjs`; ESM produces `main.mjs`; `auto` uses the nearest `package.json` and TypeScript module settings. Keep the `start` script aligned with the chosen format, or set the format explicitly.

</details>

<details>
<summary><strong>Why does the port stay busy after a rebuild?</strong></summary>

Wrap startup with `runManagedBootstrap`, return an object whose `close` method releases the server and other resources, and enable framework shutdown hooks when applicable. Without the runtime handshake, Vite Link can signal the process but cannot perform application-specific cleanup for it.

</details>

<details>
<summary><strong>Why does a native or database dependency fail after bundling?</strong></summary>

Native modules and runtime-sensitive packages should normally remain external. Common packages are externalized by default; add project-specific packages to `external.alwaysExternal`, or remove an accidental `noExternal` rule that selected them for bundling.

</details>

<details>
<summary><strong>Should I use <code>vite build</code> or <code>vite-link build</code>?</strong></summary>

Use `vite build` when plugin transforms and asset copying are enough. Use `vite-link build` for the complete backend release pipeline: diagnostics, type checking, build validation, metadata generation, and assets.

</details>

## Reliability and scope

- File and diagnostic work uses bounded concurrency.
- Rapid rebuilds collapse into deterministic restart requests.
- Build errors do not replace a known-good child process.
- Asset sources, output targets, symlinks, and collisions are validated before writes or deletes.
- Secret-looking environment names are blocked from build-time inlining by default.
- Production dependencies remain external unless configuration explicitly selects them for bundling.
- Packed-package smoke tests exercise real Nest builds, both package module formats, process startup, and HTTP responses.

These guarantees describe Vite Link as a development and build tool. Runtime capacity, traffic handling, deployment topology, and production availability remain properties of the application and its platform.

### Vite Link and vanilla Nest comparison

The repository includes a reproducible comparison that builds and runs matched generated Nest workloads through Vite Link and the vanilla Nest CLI. The application behavior and generated feature modules are equivalent; only the tool-specific bootstrap and configuration differ:

```bash
npm run perf:compare:nest -- --output performance-nest-comparison.json
```

Reference snapshot from the same 100-module fixture on Windows x64 with Node 22.16.0:

| Metric                                    |   Vite Link | Vanilla Nest | Result                  |
| ----------------------------------------- | ----------: | -----------: | ----------------------- |
| Clean production build p50                |      2.40 s |       3.11 s | 22.7% faster            |
| Production start to `/health` p50         |      596 ms |       642 ms | 7.2% faster             |
| Dev cold start to `/health` p50           |      1.62 s |       3.37 s | 51.9% faster            |
| Dev reload: edit to revised `/health` p50 |      896 ms |       1.36 s | 34.0% faster            |
| HTTP throughput mean                      | 47.8k req/s |  47.2k req/s | Parity (within ±5%)     |
| Emitted output                            |     282 KiB |      307 KiB | 8.1% smaller            |
| Emitted files                             |           2 |          206 | One bundle + source map |

The report compares clean production-build duration, production and development readiness, source-edit-to-revised-health reload time, emitted output size, and an informational Autocannon HTTP parity sample. In practical terms, the edit metric represents Vite Link's hot-reload experience. Its implementation is managed build-and-restart rather than provider-level, state-preserving HMR: the measurement includes rebuild, graceful process replacement, and readiness, compared with vanilla Nest watch mode. Build measurements include each tool's normal production pipeline: Vite Link performs its configured diagnostics and type check before bundling, while the Nest CLI performs its default TypeScript compilation. Development readiness reflects each documented workflow: Vite Link reports application readiness while its configured asynchronous type check continues, whereas Nest watch completes compiler checking before readiness. It therefore compares developer-perceived readiness, not equal type-check latency. The generated report records exact package versions, workload size, runtime, operating system, hardware, repetitions, percentiles, variability, per-round HTTP values, request count, and failures. A comparison whose coefficient of variation exceeds `0.10` is marked inconclusive instead of naming a winner. Stable HTTP-throughput differences within `±5%` are reported as runtime parity.

Treat results as environment-specific evidence. Build and startup measurements characterize the toolchains. The HTTP sample checks that the generated runtime remains comparable; it is not a Vite Link throughput or scalability claim.

## Contributing, security, and license

Run `npm ci` and `npm run check` before opening a pull request. See the [contributing guide](CONTRIBUTING.md) for the complete workflow.

Report suspected vulnerabilities privately according to the [security policy](SECURITY.md).

Vite Link is available under the [MIT License](LICENSE).
