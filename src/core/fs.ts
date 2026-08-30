import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

export async function assertReadable(path: string): Promise<void> {
  await access(path)
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

export async function emptyDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

export async function writeText(path: string, text: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, text, 'utf8')
}

export async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
  const text = await readText(path)
  return JSON.parse(stripJsonComments(text)) as T
}

export function stripJsonComments(input: string): string {
  let output = ''
  let inString = false
  let inBlockComment = false
  let inLineComment = false
  let quote = ''

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false
        output += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (inString) {
      output += char
      if (char === '\\') {
        i += 1
        output += input[i] ?? ''
        continue
      }
      if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    output += char
  }

  return output
}

export async function findUp(name: string, start = process.cwd()): Promise<string | undefined> {
  let current = resolve(start)

  while (true) {
    const candidate = join(current, name)
    if (await fileExists(candidate)) return candidate

    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/')
}
