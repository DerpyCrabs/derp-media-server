import fs from 'fs'
import path from 'path'
import stripJsonComments from 'strip-json-comments'
import { randomUUID } from 'crypto'
import { Mutex } from './mutex'

interface AuthConfig {
  enabled: boolean
  /** Password required when enabled */
  password?: string
  adminAccessDomains?: string[]
  /** Session cookie max age in seconds (optional; default 7 days). */
  sessionMaxAgeSeconds?: number
  /** Whether auth cookies require HTTPS. Defaults to true in production. */
  secureCookies?: boolean
}

export interface AiConfig {
  provider: 'openrouter' | 'lmstudio' | 'openai-compatible'
  apiKey?: string
  baseUrl?: string
  model?: string
  systemPrompt?: string
}

export interface McpServerConfig {
  url: string
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

export interface FileSearchConfig {
  enabled: boolean
  indexPath: string
  watchMode: 'auto' | 'off'
  maxRecursiveWatchers: number
  maxFsConcurrency: number
  reconcileDirectoriesPerSecond: number
}

export interface TlsConfig {
  certPath?: string
  keyPath?: string
  pfxPath?: string
  passphrase?: string
}

export interface MediaRoot {
  id: string
  name: string
  path: string
  editableFolders: string[]
  readOnly: boolean
  source: 'config' | 'mount'
}

export interface RuntimeMount {
  id: string
  name: string
  path: string
  createdAt: number
}

interface MediaDirConfig {
  path: string
  name?: string
  editableFolders?: string[]
}

interface AppConfig {
  port: number
  mediaDir: string
  editableFolders: string[]
  mediaDirs?: MediaDirConfig[]
  mediaRoots: MediaRoot[]
  libraryKey: string
  shareLinkDomain?: string
  auth?: AuthConfig
  ai?: AiConfig
  mcp?: McpConfig
  dataPath: string
  fileSearch: FileSearchConfig
  tls?: TlsConfig
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config.jsonc')
const RESERVED_MEDIA_ROOT_NAMES = new Set(['favorites', 'most played', 'shares'])

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
  const port = Number(process.env.PORT)
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    cfg.port = port
  }
  if (process.env.MEDIA_DIR) {
    cfg.mediaDir = process.env.MEDIA_DIR
    cfg.mediaDirs = undefined
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

  if (process.env.TLS_PFX_PATH) {
    cfg.tls = {
      pfxPath: path.resolve(process.env.TLS_PFX_PATH),
      passphrase: process.env.TLS_PFX_PASSPHRASE,
    }
  } else if (process.env.TLS_CERT_PATH || process.env.TLS_KEY_PATH) {
    if (!process.env.TLS_CERT_PATH || !process.env.TLS_KEY_PATH) {
      throw new Error('TLS_CERT_PATH and TLS_KEY_PATH must be set together')
    }
    cfg.tls = {
      certPath: path.resolve(process.env.TLS_CERT_PATH),
      keyPath: path.resolve(process.env.TLS_KEY_PATH),
    }
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

  if (process.env.AUTH_SECURE_COOKIES !== undefined) {
    if (!cfg.auth) cfg.auth = { enabled: false }
    cfg.auth.secureCookies =
      process.env.AUTH_SECURE_COOKIES === 'true' || process.env.AUTH_SECURE_COOKIES === '1'
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

  return finalizeMediaConfig(cfg)
}

function normalizeEditableFolders(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((f) => String(f).trim()).filter(Boolean) : []
}

function deriveMediaRootName(mediaPath: string): string {
  return path.basename(path.resolve(mediaPath)).trim()
}

function normalizeMediaRootName(mediaPath: string, explicitName: unknown): string {
  const name =
    typeof explicitName === 'string' && explicitName.trim()
      ? explicitName.trim()
      : deriveMediaRootName(mediaPath)

  if (!name) {
    throw new Error(`mediaDirs entry for "${mediaPath}" requires a name`)
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`mediaDirs name "${name}" must not contain path separators`)
  }
  if (RESERVED_MEDIA_ROOT_NAMES.has(name.toLowerCase())) {
    throw new Error(`mediaDirs name "${name}" conflicts with a virtual folder`)
  }

  return name
}

export function normalizeMediaRoots(
  mediaDir: string,
  editableFolders: string[],
  mediaDirs?: MediaDirConfig[],
): MediaRoot[] {
  const roots =
    mediaDirs && mediaDirs.length > 0
      ? mediaDirs.map((entry) => ({
          id: `config:${normalizeMediaRootName(entry.path, entry.name).toLowerCase()}`,
          name: normalizeMediaRootName(entry.path, entry.name),
          path: entry.path,
          editableFolders: normalizeEditableFolders(entry.editableFolders),
          readOnly: false,
          source: 'config' as const,
        }))
      : [
          {
            id: 'config:primary',
            name: deriveMediaRootName(mediaDir) || 'Media',
            path: mediaDir,
            editableFolders,
            readOnly: false,
            source: 'config' as const,
          },
        ]

  const seenNames = new Set<string>()
  for (const root of roots) {
    const key = root.name.toLowerCase()
    if (seenNames.has(key)) {
      throw new Error(`Duplicate mediaDirs name "${root.name}". Add explicit unique names.`)
    }
    seenNames.add(key)
  }

  return roots
}

function getLibraryKey(mediaDir: string, roots: MediaRoot[]): string {
  if (roots.length <= 1) return mediaDir
  return roots.map((root) => `${root.name}:${path.resolve(root.path)}`).join('|')
}

function finalizeMediaConfig(cfg: AppConfig): AppConfig {
  const mediaRoots = normalizeMediaRoots(cfg.mediaDir, cfg.editableFolders, cfg.mediaDirs)
  const primaryRoot = mediaRoots[0]
  return {
    ...cfg,
    mediaDir: primaryRoot.path,
    editableFolders: mediaRoots.length === 1 ? primaryRoot.editableFolders : cfg.editableFolders,
    mediaRoots,
    libraryKey: getLibraryKey(primaryRoot.path, mediaRoots),
  }
}

export function parseMcpConfig(parsed: { mcp?: unknown }): McpConfig | undefined {
  const m = parsed.mcp
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined
  const srv = (m as { servers?: unknown }).servers
  if (!srv || typeof srv !== 'object' || Array.isArray(srv)) return undefined
  const servers: Record<string, McpServerConfig> = {}
  for (const [k, v] of Object.entries(srv)) {
    const key = k.trim()
    if (!key) continue
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const urlRaw = (v as { url?: unknown }).url
    if (typeof urlRaw !== 'string' || !urlRaw.trim()) continue
    const url = urlRaw.trim()
    try {
      new URL(url)
    } catch {
      continue
    }
    servers[key] = { url }
  }
  return Object.keys(servers).length > 0 ? { servers } : undefined
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

    const normalizePort = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
        ? value
        : fallback
    const port = normalizePort(parsed.port, 3000)

    const mediaDir = parsed.mediaDir ?? process.cwd()
    const editableFolders = normalizeEditableFolders(parsed.editableFolders)
    const mediaDirs = Array.isArray(parsed.mediaDirs)
      ? parsed.mediaDirs.map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('Each mediaDirs entry must be an object with a path')
          }
          const rawPath = (entry as { path?: unknown }).path
          if (typeof rawPath !== 'string' || !rawPath.trim()) {
            throw new Error('Each mediaDirs entry requires a path')
          }
          const rawName = (entry as { name?: unknown }).name
          const rawEditableFolders = (entry as { editableFolders?: unknown }).editableFolders
          return {
            path: rawPath.trim(),
            ...(typeof rawName === 'string' && rawName.trim() ? { name: rawName.trim() } : {}),
            editableFolders: normalizeEditableFolders(rawEditableFolders),
          }
        })
      : undefined
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
    const secureCookies =
      typeof parsed.auth?.secureCookies === 'boolean' ? parsed.auth.secureCookies : undefined
    const auth =
      parsed.auth && typeof parsed.auth === 'object'
        ? {
            enabled: Boolean(parsed.auth.enabled),
            password: typeof parsed.auth.password === 'string' ? parsed.auth.password : undefined,
            adminAccessDomains,
            sessionMaxAgeSeconds,
            secureCookies,
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
    const rawTls = parsed.tls && typeof parsed.tls === 'object' ? parsed.tls : undefined
    const resolveConfigPath = (value: unknown) =>
      typeof value === 'string' && value.trim()
        ? path.resolve(configDir, value.trim())
        : undefined
    const tls: TlsConfig | undefined = rawTls
      ? {
          certPath: resolveConfigPath(rawTls.certPath),
          keyPath: resolveConfigPath(rawTls.keyPath),
          pfxPath: resolveConfigPath(rawTls.pfxPath),
          passphrase:
            typeof rawTls.passphrase === 'string' ? rawTls.passphrase : undefined,
        }
      : undefined
    if (tls?.pfxPath && (tls.certPath || tls.keyPath)) {
      throw new Error('TLS config must use either pfxPath or certPath/keyPath')
    }
    if ((tls?.certPath && !tls.keyPath) || (!tls?.certPath && tls?.keyPath)) {
      throw new Error('TLS certPath and keyPath must be configured together')
    }

    const rawFileSearch =
      parsed.fileSearch && typeof parsed.fileSearch === 'object'
        ? (parsed.fileSearch as Partial<FileSearchConfig>)
        : {}
    const clampInteger = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isInteger(value)
        ? Math.max(min, Math.min(max, value))
        : fallback
    const fileSearch: FileSearchConfig = {
      enabled: rawFileSearch.enabled !== false,
      indexPath:
        typeof rawFileSearch.indexPath === 'string' && rawFileSearch.indexPath.trim()
          ? path.resolve(configDir, rawFileSearch.indexPath.trim())
          : path.join(dataPath, '.search-index', 'files-v1.sqlite'),
      watchMode: rawFileSearch.watchMode === 'off' ? 'off' : 'auto',
      maxRecursiveWatchers: clampInteger(rawFileSearch.maxRecursiveWatchers, 32, 0, 32),
      maxFsConcurrency: clampInteger(rawFileSearch.maxFsConcurrency, 4, 1, 16),
      reconcileDirectoriesPerSecond: clampInteger(
        rawFileSearch.reconcileDirectoriesPerSecond,
        128,
        1,
        4096,
      ),
    }

    const mcp = parseMcpConfig(parsed)

    return applyEnvOverrides({
      port,
      mediaDir,
      editableFolders,
      mediaDirs,
      mediaRoots: [],
      libraryKey: mediaDir,
      shareLinkDomain,
      auth,
      ai,
      mcp,
      dataPath,
      fileSearch,
      tls,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`Config file not found at ${configPath}, using defaults`)
      return applyEnvOverrides({
        port: 3000,
        mediaDir: process.cwd(),
        editableFolders: [],
        mediaDirs: undefined,
        mediaRoots: [],
        libraryKey: process.cwd(),
        shareLinkDomain: undefined,
        auth: { enabled: false, password: undefined },
        mcp: undefined,
        dataPath: path.dirname(configPath),
        fileSearch: {
          enabled: true,
          indexPath: path.join(path.dirname(configPath), '.search-index', 'files-v1.sqlite'),
          watchMode: 'auto',
          maxRecursiveWatchers: 32,
          maxFsConcurrency: 4,
          reconcileDirectoriesPerSecond: 128,
        },
        tls: undefined,
      })
    }
    throw error
  }
}

/** Config loaded once when this module is first imported. */
export const config = loadConfigOnce()

const MOUNTS_FILE = path.join(config.dataPath, 'mounts.json')
const mountsMutex = new Mutex()
let runtimeMounts = loadRuntimeMounts()
const mountListeners = new Set<() => void>()

function loadRuntimeMounts(): RuntimeMount[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(MOUNTS_FILE, 'utf-8')) as {
      version?: number
      mounts?: unknown
    }
    if (!Array.isArray(parsed.mounts)) return []
    return parsed.mounts.filter((entry): entry is RuntimeMount => {
      if (!entry || typeof entry !== 'object') return false
      const value = entry as Partial<RuntimeMount>
      return (
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.path === 'string' &&
        typeof value.createdAt === 'number'
      )
    })
  } catch {
    return []
  }
}

function runtimeRoot(mount: RuntimeMount): MediaRoot {
  return {
    ...mount,
    editableFolders: [],
    readOnly: true,
    source: 'mount',
  }
}

async function persistRuntimeMounts(next: RuntimeMount[]): Promise<void> {
  await fs.promises.mkdir(config.dataPath, { recursive: true })
  const tempFile = `${MOUNTS_FILE}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(
    tempFile,
    JSON.stringify({ version: 1, mounts: next }, null, 2),
    'utf-8',
  )
  await fs.promises.rename(tempFile, MOUNTS_FILE)
  runtimeMounts = next
  mountListeners.forEach((listener) => listener())
}

async function validateMountInput(
  input: { name: string; path: string },
  exceptId?: string,
): Promise<{ name: string; path: string }> {
  const mountPath = input.path.trim()
  const name = normalizeMediaRootName(mountPath, input.name)
  if (!path.isAbsolute(mountPath)) throw new Error('Mount path must be absolute')
  const canonicalPath = await fs.promises.realpath(mountPath)
  const stat = await fs.promises.stat(canonicalPath)
  if (!stat.isDirectory()) throw new Error('Mount path must be a directory')

  const allRoots = getMediaRoots().filter((root) => root.id !== exceptId)
  if (allRoots.some((root) => root.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Media root name "${name}" already exists`)
  }
  const pathKey = process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath
  for (const root of allRoots) {
    let rootCanonical: string
    try {
      rootCanonical = await fs.promises.realpath(root.path)
    } catch {
      rootCanonical = path.resolve(root.path)
    }
    const rootKey = process.platform === 'win32' ? rootCanonical.toLowerCase() : rootCanonical
    if (rootKey === pathKey) throw new Error('This directory is already configured as a media root')
    const relative = path.relative(rootCanonical, canonicalPath)
    const reverse = path.relative(canonicalPath, rootCanonical)
    const nested = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    const contains = reverse && !reverse.startsWith('..') && !path.isAbsolute(reverse)
    if (nested || contains) throw new Error('Media roots must not overlap')
  }
  return { name, path: canonicalPath }
}

export function getRuntimeMounts(): RuntimeMount[] {
  return runtimeMounts.map((mount) => ({ ...mount }))
}

export async function addRuntimeMount(input: {
  name: string
  path: string
}): Promise<RuntimeMount> {
  const release = await mountsMutex.acquire()
  try {
    const validated = await validateMountInput(input)
    const mount = { id: randomUUID(), ...validated, createdAt: Date.now() }
    await persistRuntimeMounts([...runtimeMounts, mount])
    return mount
  } finally {
    release()
  }
}

export async function updateRuntimeMount(
  id: string,
  input: { name: string; path: string },
): Promise<RuntimeMount | null> {
  const release = await mountsMutex.acquire()
  try {
    const index = runtimeMounts.findIndex((mount) => mount.id === id)
    if (index === -1) return null
    const validated = await validateMountInput(input, id)
    const updated = { ...runtimeMounts[index], ...validated }
    const next = runtimeMounts.slice()
    next[index] = updated
    await persistRuntimeMounts(next)
    return updated
  } finally {
    release()
  }
}

export async function removeRuntimeMount(id: string): Promise<boolean> {
  const release = await mountsMutex.acquire()
  try {
    const next = runtimeMounts.filter((mount) => mount.id !== id)
    if (next.length === runtimeMounts.length) return false
    await persistRuntimeMounts(next)
    return true
  } finally {
    release()
  }
}

export function subscribeMountChanges(listener: () => void): () => void {
  mountListeners.add(listener)
  return () => mountListeners.delete(listener)
}

export function getMediaRoots(): MediaRoot[] {
  return [...config.mediaRoots, ...runtimeMounts.map(runtimeRoot)]
}

export function hasMultipleMediaRoots(): boolean {
  return getMediaRoots().length > 1
}

export function getMediaRootByName(name: string): MediaRoot | undefined {
  return getMediaRoots().find((root) => root.name.toLowerCase() === name.toLowerCase())
}

export function getMediaRootById(id: string): MediaRoot | undefined {
  return getMediaRoots().find((root) => root.id === id)
}

export function getMcpConfig(): McpConfig | undefined {
  return config.mcp
}

export function getDataFilePath(filename: string): string {
  return path.join(config.dataPath, filename)
}

export function getAiConfig(): AiConfig | null {
  return config.ai ?? null
}
