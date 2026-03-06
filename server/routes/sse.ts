import type { FastifyInstance, FastifyReply } from 'fastify'
import { addFileClient, removeFileClient, type FileChangeCallback } from '@/lib/file-change-emitter'
import { HttpError, validateShareAccess } from '@/lib/share-access'
import path from 'path'
import { getDataFilePath } from '@/lib/config'
import { promises as fs } from 'fs'

const SETTINGS_FILE = getDataFilePath('settings.json')

// ── Settings watcher (shared across all SSE clients) ─────────────────
type SettingsCallback = (data: string) => void

const settingsClients = new Set<SettingsCallback>()
let lastModified = 0
let watchInterval: ReturnType<typeof setInterval> | null = null

async function watchSettings() {
  try {
    const stats = await fs.stat(SETTINGS_FILE)
    const currentModified = stats.mtimeMs

    if (lastModified !== 0 && currentModified !== lastModified) {
      const message = `data: ${JSON.stringify({ type: 'settings-changed', timestamp: Date.now() })}\n\n`
      settingsClients.forEach((cb) => {
        try {
          cb(message)
        } catch {
          settingsClients.delete(cb)
        }
      })
    }

    lastModified = currentModified
  } catch (error) {
    console.error('Error watching settings:', error)
  }
}

function startSettingsWatch() {
  if (!watchInterval && settingsClients.size > 0) {
    watchInterval = setInterval(watchSettings, 500)
  }
}

function stopSettingsWatch() {
  if (watchInterval && settingsClients.size === 0) {
    clearInterval(watchInterval)
    watchInterval = null
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function initSSE(reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

function writeSSE(reply: FastifyReply, data: string) {
  reply.raw.write(data)
}

function encodeSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return normalized === '.' ? '' : normalized
}

function scopeShareChange(
  share: { path: string; isDirectory: boolean },
  event: { directory: string; path?: string },
): { type: 'files-changed'; directory: string; path?: string; timestamp: number } | null {
  const shareRoot = normalizePath(share.path)
  const eventDirectory = normalizePath(event.directory)
  const eventPath = event.path ? normalizePath(event.path) : undefined

  if (!share.isDirectory) {
    if (!eventPath || eventPath !== shareRoot) return null
    return {
      type: 'files-changed',
      directory: '',
      path: '',
      timestamp: Date.now(),
    }
  }

  const withinShare = (target: string) => target === shareRoot || target.startsWith(`${shareRoot}/`)
  if (eventPath && !withinShare(eventPath)) return null
  if (!withinShare(eventDirectory)) return null

  const relativeDirectory =
    eventDirectory === shareRoot ? '' : path.posix.relative(shareRoot, eventDirectory)
  const relativePath =
    eventPath !== undefined
      ? eventPath === shareRoot
        ? ''
        : path.posix.relative(shareRoot, eventPath)
      : undefined

  return {
    type: 'files-changed',
    directory: normalizePath(relativeDirectory),
    ...(relativePath !== undefined ? { path: normalizePath(relativePath) } : {}),
    timestamp: Date.now(),
  }
}

export function registerSSERoutes(app: FastifyInstance) {
  // ── File change events ─────────────────────────────────────────────
  app.get('/api/files/stream', async (request, reply) => {
    initSSE(reply)

    const cb: FileChangeCallback = (event) =>
      writeSSE(reply, encodeSSE({ type: 'files-changed', ...event, timestamp: Date.now() }))
    addFileClient(cb)

    writeSSE(reply, encodeSSE({ type: 'connected', timestamp: Date.now() }))

    const keepAlive = setInterval(() => {
      try {
        writeSSE(reply, ': keep-alive\n\n')
      } catch {
        clearInterval(keepAlive)
      }
    }, 30000)

    request.raw.on('close', () => {
      removeFileClient(cb)
      clearInterval(keepAlive)
    })

    return reply
  })

  app.get('/api/share/:token/stream', async (request, reply) => {
    const { token } = request.params as { token: string }

    let share
    try {
      ;({ share } = await validateShareAccess(
        (request.cookies as Record<string, string | undefined>) ?? {},
        token,
      ))
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      return reply.code(500).send({ error: 'Failed to open share stream' })
    }

    initSSE(reply)

    const cb: FileChangeCallback = (event) => {
      const scoped = scopeShareChange(share, event)
      if (!scoped) return
      writeSSE(reply, encodeSSE(scoped))
    }
    addFileClient(cb)

    writeSSE(reply, encodeSSE({ type: 'connected', timestamp: Date.now() }))

    const keepAlive = setInterval(() => {
      try {
        writeSSE(reply, ': keep-alive\n\n')
      } catch {
        clearInterval(keepAlive)
      }
    }, 30000)

    request.raw.on('close', () => {
      removeFileClient(cb)
      clearInterval(keepAlive)
    })

    return reply
  })

  // ── Settings change events ─────────────────────────────────────────
  app.get('/api/settings/stream', async (request, reply) => {
    initSSE(reply)

    const cb: SettingsCallback = (message) => writeSSE(reply, message)
    settingsClients.add(cb)
    startSettingsWatch()

    writeSSE(reply, encodeSSE({ type: 'connected', timestamp: Date.now() }))

    const keepAlive = setInterval(() => {
      try {
        writeSSE(reply, ': keep-alive\n\n')
      } catch {
        clearInterval(keepAlive)
      }
    }, 30000)

    request.raw.on('close', () => {
      settingsClients.delete(cb)
      clearInterval(keepAlive)
      stopSettingsWatch()
    })

    return reply
  })
}
