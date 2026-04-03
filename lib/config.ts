import fs from 'fs'
import path from 'path'
import stripJsonComments from 'strip-json-comments'

interface AuthConfig {
  enabled: boolean
  /** Password required when enabled */
  password?: string
  adminAccessDomains?: string[]
  /** Session cookie max age in seconds (optional; default 7 days). */
  sessionMaxAgeSeconds?: number
}

export interface AiConfig {
  provider: 'openrouter' | 'lmstudio' | 'openai-compatible'
  apiKey?: string
  baseUrl?: string
  model?: string
  systemPrompt?: string
}

interface AppConfig {
  mediaDir: string
  editableFolders: string[]
  shareLinkDomain?: string
  auth?: AuthConfig
  ai?: AiConfig
  dataPath: string
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

  if (process.env.AUTH_SESSION_MAX_AGE !== undefined) {
    if (!cfg.auth) cfg.auth = { enabled: false }
    const n = parseInt(process.env.AUTH_SESSION_MAX_AGE, 10)
    if (!Number.isNaN(n) && n > 0) {
      cfg.auth.sessionMaxAgeSeconds = n
    }
  }

  if (process.env.AI_PROVIDER) {
    const p = process.env.AI_PROVIDER as AiConfig['provider']
    if (p === 'openrouter' || p === 'lmstudio' || p === 'openai-compatible') {
      if (!cfg.ai) cfg.ai = { provider: p }
      else cfg.ai.provider = p
    }
  }
  if (process.env.AI_API_KEY) {
    if (!cfg.ai) cfg.ai = { provider: 'openai-compatible' }
    cfg.ai.apiKey = process.env.AI_API_KEY
  }
  if (process.env.AI_BASE_URL) {
    if (!cfg.ai) cfg.ai = { provider: 'openai-compatible' }
    cfg.ai.baseUrl = process.env.AI_BASE_URL
  }
  if (process.env.AI_MODEL) {
    if (!cfg.ai) cfg.ai = { provider: 'openai-compatible' }
    cfg.ai.model = process.env.AI_MODEL
  }
  if (process.env.AI_SYSTEM_PROMPT) {
    if (!cfg.ai) cfg.ai = { provider: 'openai-compatible' }
    cfg.ai.systemPrompt = process.env.AI_SYSTEM_PROMPT
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
    const sessionRaw = parsed.auth?.sessionMaxAgeSeconds
    const sessionMaxAgeSeconds =
      typeof sessionRaw === 'number' && Number.isFinite(sessionRaw) && sessionRaw > 0
        ? Math.floor(sessionRaw)
        : undefined
    const auth =
      parsed.auth && typeof parsed.auth === 'object'
        ? {
            enabled: Boolean(parsed.auth.enabled),
            password: typeof parsed.auth.password === 'string' ? parsed.auth.password : undefined,
            adminAccessDomains,
            sessionMaxAgeSeconds,
          }
        : { enabled: false }

    const AI_PROVIDERS = new Set(['openrouter', 'lmstudio', 'openai-compatible'])
    const ai: AiConfig | undefined =
      parsed.ai &&
      typeof parsed.ai === 'object' &&
      AI_PROVIDERS.has((parsed.ai as AiConfig).provider)
        ? {
            provider: (parsed.ai as AiConfig).provider,
            apiKey:
              typeof (parsed.ai as AiConfig).apiKey === 'string'
                ? (parsed.ai as AiConfig).apiKey
                : undefined,
            baseUrl:
              typeof (parsed.ai as AiConfig).baseUrl === 'string'
                ? (parsed.ai as AiConfig).baseUrl
                : undefined,
            model:
              typeof (parsed.ai as AiConfig).model === 'string'
                ? (parsed.ai as AiConfig).model
                : undefined,
            systemPrompt:
              typeof (parsed.ai as AiConfig).systemPrompt === 'string'
                ? (parsed.ai as AiConfig).systemPrompt
                : undefined,
          }
        : undefined

    const configDir = path.dirname(configPath)
    const dataPath =
      typeof parsed.dataPath === 'string' ? path.resolve(configDir, parsed.dataPath) : configDir

    return applyEnvOverrides({ mediaDir, editableFolders, shareLinkDomain, auth, ai, dataPath })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`Config file not found at ${configPath}, using defaults`)
      return applyEnvOverrides({
        mediaDir: process.cwd(),
        editableFolders: [],
        shareLinkDomain: undefined,
        auth: { enabled: false, password: undefined },
        dataPath: path.dirname(configPath),
      })
    }
    throw error
  }
}

/** Config loaded once when this module is first imported. */
export const config = loadConfigOnce()

export function getDataFilePath(filename: string): string {
  return path.join(config.dataPath, filename)
}

export function getAiConfig(): AiConfig | null {
  return config.ai ?? null
}
