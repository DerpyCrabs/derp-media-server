import fs from 'fs'
import path from 'path'
import stripJsonComments from 'strip-json-comments'

export interface AuthConfig {
  enabled: boolean
  /** Password required when enabled */
  password?: string
  adminAccessDomains?: string[]
}

export interface AppConfig {
  mediaDir: string
  editableFolders: string[]
  shareLinkDomain?: string
  auth?: AuthConfig
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

function applyEnvOverrides(cfg: AppConfig): AppConfig {
  if (process.env.MEDIA_DIR) {
    cfg.mediaDir = process.env.MEDIA_DIR
  }

  if (process.env.EDITABLE_FOLDERS) {
    cfg.editableFolders = process.env.EDITABLE_FOLDERS.split(',')
      .map((f) => f.trim())
      .filter(Boolean)
  }

  if (process.env.SHARE_LINK_DOMAIN) {
    const s = process.env.SHARE_LINK_DOMAIN.trim().replace(/\/$/, '')
    cfg.shareLinkDomain = s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`
  }

  if (process.env.AUTH_ENABLED !== undefined) {
    if (!cfg.auth) cfg.auth = { enabled: false }
    cfg.auth.enabled = process.env.AUTH_ENABLED === 'true' || process.env.AUTH_ENABLED === '1'
  }

  if (process.env.AUTH_PASSWORD !== undefined) {
    if (!cfg.auth) cfg.auth = { enabled: false }
    cfg.auth.password = process.env.AUTH_PASSWORD || undefined
  }

  if (process.env.AUTH_ADMIN_ACCESS_DOMAINS) {
    if (!cfg.auth) cfg.auth = { enabled: false }
    cfg.auth.adminAccessDomains = process.env.AUTH_ADMIN_ACCESS_DOMAINS.split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
  }

  return cfg
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

    const parsed = JSON.parse(
      stripJsonComments(content, { trailingCommas: true }),
    ) as Partial<AppConfig>

    const mediaDir = parsed.mediaDir ?? process.cwd()
    const editableFolders = Array.isArray(parsed.editableFolders)
      ? parsed.editableFolders.map((f) => String(f).trim()).filter(Boolean)
      : []
    const rawShare = typeof parsed.shareLinkDomain === 'string' && parsed.shareLinkDomain.trim()
    const shareLinkDomain = rawShare
      ? (() => {
          const s = parsed.shareLinkDomain!.trim().replace(/\/$/, '')
          return s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`
        })()
      : undefined
    const adminAccessDomains = Array.isArray(parsed.auth?.adminAccessDomains)
      ? parsed.auth.adminAccessDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : undefined
    const auth =
      parsed.auth && typeof parsed.auth === 'object'
        ? {
            enabled: Boolean(parsed.auth.enabled),
            password: typeof parsed.auth.password === 'string' ? parsed.auth.password : undefined,
            adminAccessDomains,
          }
        : { enabled: false }

    return applyEnvOverrides({ mediaDir, editableFolders, shareLinkDomain, auth })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`Config file not found at ${configPath}, using defaults`)
      return applyEnvOverrides({
        mediaDir: process.cwd(),
        editableFolders: [],
        shareLinkDomain: undefined,
        auth: { enabled: false, password: undefined },
      })
    }
    throw error
  }
}

/** Config loaded once when this module is first imported. */
export const config = loadConfigOnce()
