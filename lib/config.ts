import fs from 'fs'
import path from 'path'
import stripJsonComments from 'strip-json-comments'

export interface AppConfig {
  mediaDir: string
  editableFolders: string[]
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config.jsonc')

function getConfigPath(): string {
  const envPath = process.env.CONFIG_PATH
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath)
  }

  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--config-path' && argv[i + 1]) {
      const p = argv[i + 1]
      return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
    }
    const match = arg.match(/^--config-path=(.+)$/)
    if (match) {
      const p = match[1]
      return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
    }
  }

  return DEFAULT_CONFIG_PATH
}

function loadConfigOnce(): AppConfig {
  let configPath = getConfigPath()
  const isDefaultPath = configPath === DEFAULT_CONFIG_PATH

  try {
    let content: string
    try {
      content = fs.readFileSync(configPath, 'utf-8')
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code === 'ENOENT' && isDefaultPath) {
        const jsonFallback = path.join(process.cwd(), 'config.json')
        content = fs.readFileSync(jsonFallback, 'utf-8')
        configPath = jsonFallback
      } else {
        throw readError
      }
    }

    const parsed = JSON.parse(stripJsonComments(content)) as Partial<AppConfig>

    const mediaDir = parsed.mediaDir ?? process.cwd()
    const editableFolders = Array.isArray(parsed.editableFolders)
      ? parsed.editableFolders.map((f) => String(f).trim()).filter(Boolean)
      : []

    return { mediaDir, editableFolders }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`Config file not found at ${configPath}, using defaults`)
      return {
        mediaDir: process.cwd(),
        editableFolders: [],
      }
    }
    throw error
  }
}

/** Config loaded once when this module is first imported. */
export const config = loadConfigOnce()
