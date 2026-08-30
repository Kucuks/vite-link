import { defineConfig } from 'vite'
import nest from 'vite-kit/nest'

export default defineConfig({
  plugins: [
    nest({
      entry: 'src/main.ts',
      build: {
        format: 'cjs',
        outDir: 'dist',
      },
      dev: {
        strategy: 'restart',
        port: 3000,
      },
      typecheck: {
        dev: 'async',
        build: 'before',
      },
      diagnostics: {
        enabled: true,
        strict: false,
      },
      assets: [{ include: ['src/**/*.graphql', 'src/views/**/*'], restart: true }],
    }),
  ],
})
