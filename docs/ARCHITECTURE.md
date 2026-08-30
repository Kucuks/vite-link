# Architecture

Vite Kit is a framework-neutral core with optional runtime adapters.

```txt
vite-kit core
  ├─ config and tsconfig resolution
  ├─ Vite/Rolldown SSR build
  ├─ diagnostics pipeline
  ├─ type-check pipeline
  ├─ asset and metadata pipelines
  └─ managed child-process lifecycle
       └─ adapters
            └─ Nest: decorator transform + diagnostics + defaults
```

## Build pipeline

```txt
load Vite config once
  ↓
extract toolkit and adapter options
  ↓
resolve project config
  ↓
core + adapter diagnostics
  ↓
optional tsc --noEmit
  ↓
Vite SSR build
  ↓
validate emitted entry
  ↓
explicit metadata commands
  ↓
bounded asset copy
```

Direct Vite usage receives adapter plugins alongside the core plugin. In managed CLI mode those plugins are stripped from the loaded user config and reconstructed once in the inline build config, preventing duplicate transforms, diagnostics, and asset lifecycle hooks.

## Development pipeline

```txt
source change
  ↓
Rolldown build watcher
  ↓
dist/main.cjs or dist/main.mjs
  ↓
debounced child restart
```

The first successful build starts the application. An initial build error leaves the watcher running so development can recover after the source is fixed. Later successful builds schedule a restart; build errors leave the last successful child running. Restart requests are collapsed and teardown cancels queued work before closing watchers and the child. Partially started development resources are also closed when watcher setup fails.

## Process lifecycle

Applications may use `runManagedBootstrap`. When started with an IPC channel, the helper advertises managed-shutdown support. The parent then requests application-level close and waits for process exit. Applications without the helper receive the configured signal. In both cases the runner uses the force signal only after `gracefulTimeout`.

## Adapter contract

An adapter owns a stable name and may provide:

- Vite plugins constructed from toolkit options;
- resolved-config diagnostics;
- per-source diagnostics sharing the core's single TypeScript parse.

The core has no Nest imports, package defaults, decorator rules, or Nest-specific messages. The Nest adapter is a separate export.

## Nest TypeScript transform

The Nest adapter runs TypeScript transpilation before Rolldown for project `.ts`, `.mts`, and `.cts` files. This lowers legacy decorators and emits configured decorator metadata. It skips declaration files and `node_modules`; type checking remains a separate `tsc --noEmit` step.

## Assets and backpressure

Initial copy and watch-event work use fixed concurrency. Watchers receive static directory roots because Chokidar 4 does not interpret glob paths. Each file's events remain ordered, while a global queue bounds simultaneous copies. Source realpaths, target realpaths, target symlinks, mapping collisions, and project-root boundaries are validated before writes or deletes.

## Configuration ownership

The toolkit owns entry, output format/names, SSR target, externalization, and Rolldown output fields. Other Vite options survive merging. Adapter factories execute once per build path. Vite mode is retained for environment-file loading and adapter setup.

## Evidence boundary

Unit and integration tests cover the framework-neutral adapter path, direct Vite Nest transform, real build/watch/start/restart flow, process drain/fallback, asset safety, tsconfig inheritance, and metadata teardown. The tarball smoke uses a real Nest application. Local performance results characterize the development tool only and do not establish application request capacity or production scalability.
