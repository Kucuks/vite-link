import type ts from 'typescript'
import type { Plugin, PluginOption, UserConfig } from 'vite'

export type ModuleFormat = 'auto' | 'esm' | 'cjs'
export type DevStrategy = 'restart'
export type TypecheckMode = false | 'async' | 'before'
export type DiagnosticSeverity = 'info' | 'warn' | 'error' | 'fatal'

export interface AssetPattern {
  include: string | string[]
  exclude?: string | string[]
  base?: string
  outDir?: string
  restart?: boolean
}

export interface RestartOptions {
  debounce?: number
  gracefulTimeout?: number
  killSignal?: NodeJS.Signals
  forceKillSignal?: NodeJS.Signals
  nodeArgs?: string[]
  env?: Record<string, string>
}

export interface DevOptions extends RestartOptions {
  strategy?: DevStrategy
  port?: number
}

export interface BuildOptions {
  outDir?: string
  emptyOutDir?: boolean
  sourcemap?: boolean | 'inline' | 'hidden'
  minify?: false | 'oxc' | 'esbuild' | 'terser'
  target?: string | string[]
  format?: ModuleFormat
  entryFileName?: string
  chunkFileNames?: string
  preserveModules?: boolean
}

export interface TypecheckOptions {
  dev?: TypecheckMode
  build?: TypecheckMode
  tsconfig?: string
}

export interface MetadataOptions {
  enabled?: boolean
  commands?: string[]
  watch?: boolean
}

export interface DiagnosticsOptions {
  enabled?: boolean
  strict?: boolean
  scanSource?: boolean
  failOn?: DiagnosticSeverity
}

export interface ExternalOptions {
  dependencies?: boolean
  devDependencies?: boolean
  peerDependencies?: boolean
  include?: Array<string | RegExp>
  exclude?: Array<string | RegExp>
  alwaysExternal?: Array<string | RegExp>
  noExternal?: Array<string | RegExp>
}

export interface MonorepoOptions {
  dedupe?: string[]
}

export interface EnvOptions {
  inline?: string[]
  keepRuntime?: boolean
  forbidInlineSecrets?: boolean
}

export interface ViteKitOptions {
  root?: string
  entry?: string
  tsconfig?: string
  sourceRoot?: string
  clearScreen?: boolean
  build?: BuildOptions
  dev?: DevOptions
  assets?: AssetPattern[]
  typecheck?: boolean | TypecheckOptions
  metadata?: false | MetadataOptions
  diagnostics?: boolean | DiagnosticsOptions
  external?: ExternalOptions
  monorepo?: MonorepoOptions
  env?: EnvOptions
  tsconfigPaths?: boolean
  adapters?: ViteKitAdapter[]
}

export interface ResolvedViteKitConfig {
  root: string
  mode: string
  entry: string
  tsconfig: string
  sourceRoot: string
  clearScreen: boolean
  build: Required<BuildOptions>
  dev: Required<Omit<DevOptions, 'env'>> & { env: Record<string, string> }
  assets: AssetPattern[]
  typecheck: Required<TypecheckOptions>
  metadata: Required<MetadataOptions>
  diagnostics: Required<DiagnosticsOptions>
  external: Required<ExternalOptions>
  monorepo: Required<MonorepoOptions>
  env: Required<EnvOptions>
  tsconfigPaths: boolean
  adapters: ViteKitAdapter[]
  packageJsonPath: string | undefined
  tsconfigRaw: Record<string, unknown>
  packageJson: Record<string, unknown>
  originalOptions: ViteKitOptions
}

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  file?: string | undefined
  hint?: string | undefined
}

export interface SourceDiagnosticContext {
  config: ResolvedViteKitConfig
  file: string
  text: string
  sourceFile: ts.SourceFile
}

export interface ViteKitAdapter {
  name: string
  plugins?: (options: ViteKitOptions) => Plugin[]
  configDiagnostics?: (config: ResolvedViteKitConfig) => Diagnostic[] | Promise<Diagnostic[]>
  sourceDiagnostics?: (context: SourceDiagnosticContext) => Diagnostic[] | Promise<Diagnostic[]>
}

export interface ViteKitPlugin extends Plugin {
  __viteKit?: {
    options: ViteKitOptions
  }
}

export interface ViteKitManagedPlugin extends Plugin {
  __viteKitManaged?: true
}

export type ViteKitPluginOption = PluginOption[]

export interface LoadedViteKitConfig {
  viteConfig: UserConfig
  viteKitOptions: ViteKitOptions
  configFile: string | undefined
}
