# Vite Kit agent guide

This file applies to the whole repository. Keep changes small, testable, and aligned with the public package contract.

## Product contract

- The product and CLI are named **Vite Kit** and `vite-kit`.
- The public npm package is `vite-kit`.
- The core is framework-neutral. Framework behavior belongs in `src/adapters`.
- Nest is the first bundled adapter, exposed as `vite-kit/nest`; it is not a core dependency.
- Supported public entry points are `vite-kit`, `vite-kit/plugin`, `vite-kit/nest`, and `vite-kit/runtime`.
- Development uses a build-and-restart process boundary. Do not introduce provider-level hot swapping as an implicit behavior.

## Repository map

- `src/core`, `src/config`: framework-neutral build and configuration primitives
- `src/process`: managed child-process lifecycle
- `src/assets`, `src/metadata`, `src/typecheck`, `src/diagnostics`: independent pipelines
- `src/adapters`: optional framework integrations
- `test`: unit, integration, lifecycle, and performance tests
- `scripts`: packed-package and real-framework verification
- `examples`: runnable consumer examples
- `docs`: public architecture and API guidance

## Working rules

- Use npm and the committed `package-lock.json`.
- Support the Node, Vite, and TypeScript ranges declared in `package.json`.
- Keep TypeScript strict and ESM-first; preserve both ESM and CommonJS package exports.
- Do not import framework packages from the core.
- Keep file concurrency bounded and process shutdown deterministic.
- Treat filesystem boundaries, symlinks, output collisions, environment inlining, and child-process cleanup as security-sensitive.
- Add or update tests with every behavior change.
- Update README or `docs` only when the public contract or user workflow changes.
- Never edit `dist` or `package-lock.json` by hand; generate them with the project commands.
- Do not publish, tag, push, or create a release unless the user explicitly requests it.

## Commands

- `npm ci`: reproducible install
- `npm run typecheck`: strict TypeScript validation
- `npm run lint`: source and test linting
- `npm run format:check`: formatting validation
- `npm run test:coverage`: test suite with coverage
- `npm run build`: ESM, CommonJS, declarations, and source maps
- `npm run smoke:nest`: packed tarball in a real Nest application
- `npm run audit:prod`: production dependency audit
- `npm run pack:check`: npm contents, entry points, and size guardrails
- `npm run perf:product -- performance-local.json`: local regression benchmark
- `npm run check`: release gate excluding the environment-sensitive performance benchmark

## Completion standard

Before handing off a code change, run the checks relevant to it and report exactly what ran. A public API or packaging change requires the full `npm run check`. Performance claims require a saved benchmark result and must be described as development-tool evidence, never as application request-capacity evidence.
