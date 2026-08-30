import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    nest: 'src/adapters/nest/index.ts',
    runtime: 'src/runtime.ts',
    'cli/bin': 'src/cli/bin.ts',
  },
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  },
  external: ['vite', 'typescript'],
})
