# Contributing

Thanks for helping improve Vite Link. The project stays useful by keeping its core small, framework-neutral, and predictable.

## Set up

```bash
git clone https://github.com/Kucuks/vite-link.git
cd vite-link
npm ci
npm run check
```

Use a Node version supported by `package.json`; `.nvmrc` provides the default development version.

## Make a change

- Open an issue first for a new public API, adapter, or behavior with meaningful compatibility impact.
- Keep framework-specific code under `src/adapters`.
- Add tests that show the failure before the change and the intended behavior after it.
- Update public documentation when imports, configuration, commands, or behavior change.
- Do not commit generated `dist`, coverage, benchmark output, or tarballs.

Run the full gate before opening a pull request:

```bash
npm run check
```

Changes that affect concurrency, watchers, process shutdown, package boundaries, or large-project behavior should also run:

```bash
npm run perf:product -- performance-local.json
```

The benchmark is a regression signal for the development tool, not an application throughput claim.

## Pull requests

Explain the problem, the chosen behavior, compatibility impact, and checks run. Keep unrelated cleanup out of the same pull request so the public contract remains easy to review.

By contributing, you agree that your contribution is licensed under the project's MIT License.
