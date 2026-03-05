import type { FastifyInstance } from 'fastify'
import { addFileClient, removeFileClient, type FileChangeCallback } from '@/lib/file-change-emitter'
import { promises as fs } from 'fs'
import path from 'path'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

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

function initSSE(reply: import('fastify').FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

function writeSSE(reply: import('fastify').FastifyReply, data: string) {
  reply.raw.write(data)
}

export function registerSSERoutes(app: FastifyInstance) {
  // ── File change events ─────────────────────────────────────────────
  app.get('/api/files/stream', async (request, reply) => {
    initSSE(reply)

    const cb: FileChangeCallback = (message) => writeSSE(reply, message)
    addFileClient(cb)

    writeSSE(reply, `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`)

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

    writeSSE(reply, `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`)

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
