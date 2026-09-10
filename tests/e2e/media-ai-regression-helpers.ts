import { test as base, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type Schema = {
  properties?: Record<string, Schema>
  items?: Schema
  enum?: number[]
}
type ProviderRequest = {
  messages: { role: string; content: { text?: string }[] | string }[]
  response_format: { json_schema: { schema: Schema } }
}
type Pick = { id: number; path: string; name: string; type: string; previewReady: boolean }
export type Home = {
  rows: { items: Pick[] }[]
  nextCursor: number | null
  hasMore: boolean
  feedId: string
  resumeCursor: number
  warming: boolean
}
type Library = {
  url: string
  database: DatabaseSync
  providerRequests: ProviderRequest[]
  pauseProvider: () => () => void
  seed: (count: number, folder?: string) => Pick[]
  cache: (items: Pick[]) => void
}

function modelReply(request: ProviderRequest) {
  const properties = request.response_format.json_schema.schema.properties ?? {}
  const content = request.messages.find((message) => message.role === 'user')?.content
  const text = typeof content === 'string' ? content : content?.find((part) => part.text)?.text
  const prompt = JSON.parse(text ?? '{}') as {
    query?: string
    libraryBranches?: { path: string }[]
    collections?: { id: number }[]
  }
  if (properties.terms)
    return {
      terms: [prompt.query === 'song-101' ? 'song-101' : 'song'],
      unplayed: true,
      mediaType: 'audio',
      minSeconds: 0,
      maxSeconds: 0,
      intent: 'show',
    }
  if (properties.paths) return { paths: prompt.libraryBranches?.map((branch) => branch.path) ?? [] }
  if (properties.collectionIds)
    return { collectionIds: prompt.collections?.map((collection) => collection.id) ?? [] }
  if (properties.approvedIds) return { approvedIds: properties.approvedIds.items?.enum ?? [] }
  const scoring = !!properties.items?.items?.properties?.score
  const items = (properties.items?.items?.properties?.id?.enum ?? [])
    .slice(0, scoring ? 48 : 12)
    .map((id) => ({ id, reason: 'Matching fixture media', ...(scoring ? { score: 85 } : {}) }))
  return properties.message ? { items, message: 'Fixture matches' } : { items }
}

async function freePort() {
  const listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = (listener.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  return port
}

export const test = base.extend<{ library: Library; aiEnabled: boolean }>({
  aiEnabled: [true, { option: true }],
  page: async ({ context, library }, use) => {
    void library
    const page = await context.newPage()
    try {
      await use(page)
    } finally {
      await page.close()
    }
  },
  library: async ({ aiEnabled }, use) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-media-ai-regression-'))
    const media = path.join(directory, 'media')
    fs.mkdirSync(media)
    const providerRequests: ProviderRequest[] = []
    let providerGate: Promise<void> | undefined
    const provider = http.createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString()) as ProviderRequest
        providerRequests.push(body)
        if (providerGate) await providerGate
        response.setHeader('Content-Type', 'application/json')
        response.end(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(modelReply(body)) } },
            ],
          }),
        )
      } catch (error) {
        response.statusCode = 500
        response.end(String(error))
      }
    })
    provider.listen(0, '127.0.0.1')
    await once(provider, 'listening')
    const providerPort = (provider.address() as net.AddressInfo).port
    const port = await freePort()
    const config = path.join(directory, 'config.jsonc')
    fs.writeFileSync(
      config,
      JSON.stringify({
        port,
        mediaDir: media,
        dataPath: path.join(directory, 'data'),
        mediaAi: {
          enabled: aiEnabled,
          paused: true,
          provider: 'compatible',
          endpoint: `http://127.0.0.1:${providerPort}/v1`,
          thumbnails: false,
        },
      }),
    )
    const binary = path.resolve(
      process.env.TEST_SERVER_TARGET_DIR ?? 'target',
      'release',
      process.platform === 'win32' ? 'derp-media-server.exe' : 'derp-media-server',
    )
    const server = spawn(binary, ['--production'], {
      env: { ...process.env, PORT: String(port), CONFIG_PATH: config, MEDIA_DIR: media },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    server.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    server.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    const exited = once(server, 'exit')
    const url = `http://127.0.0.1:${port}`
    let database: DatabaseSync | undefined
    try {
      await expect
        .poll(
          async () => {
            if (server.exitCode !== null) throw new Error(output)
            return fetch(`${url}/api/media-ai/status`)
              .then((response) => response.status)
              .catch(() => 0)
          },
          { timeout: 15_000 },
        )
        .toBe(200)
      database = new DatabaseSync(path.join(directory, 'data', 'app.sqlite3'))
      const db = database
      const fixtures = path.resolve(
        process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
      )
      await use({
        url,
        database: db,
        providerRequests,
        pauseProvider() {
          let release!: () => void
          providerGate = new Promise<void>((resolve) => {
            release = resolve
          })
          return () => {
            providerGate = undefined
            release()
          }
        },
        seed(count, folder = 'Songs') {
          const items: Pick[] = []
          for (let id = 1; id <= count; id++) {
            const name = `song-${String(id).padStart(3, '0')}.mp3`
            const logical = folder ? `${folder}/${name}` : name
            const full = path.join(media, logical)
            fs.mkdirSync(path.dirname(full), { recursive: true })
            fs.copyFileSync(path.join(fixtures, 'Music', 'track.mp3'), full)
            db.prepare('INSERT INTO media_catalog(id,path,name,kind) VALUES(?,?,?,?)').run(
              id,
              logical,
              name,
              'audio',
            )
            items.push({ id, path: logical, name, type: 'audio', previewReady: true })
          }
          return items
        },
        cache(items) {
          const value = {
            version: 3,
            rows: [{ title: 'For you', items }],
            generatedAt: Date.now(),
            hasMore: true,
            consideredIds: items.map((item) => item.id),
          }
          db.prepare('INSERT INTO state_documents VALUES(?,?,?,?)').run(
            'media-ai-home',
            media,
            JSON.stringify(value),
            Date.now(),
          )
        },
      })
    } finally {
      database?.close()
      server.kill()
      await exited
      provider.closeAllConnections()
      await new Promise<void>((resolve) => provider.close(() => resolve()))
      fs.rmSync(directory, { recursive: true, force: true })
    }
  },
})
