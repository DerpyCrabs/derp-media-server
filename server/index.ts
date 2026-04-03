import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { HttpError } from '@/lib/share-access'
import { authMiddleware } from './auth-middleware'
import { dehydrateForRoute } from './html'
import { registerMediaRoutes } from './routes/media'
import { registerThumbnailRoutes } from './routes/thumbnail'
import { registerDownloadRoutes } from './routes/download'
import { registerUploadRoutes } from './routes/upload'
import { registerSSERoutes } from './routes/sse'
import { registerShareMediaRoutes } from './routes/shareMedia'
import { registerFilesApiRoutes } from './routes/api/files'
import { registerSettingsApiRoutes } from './routes/api/settings'
import { registerStatsApiRoutes } from './routes/api/stats'
import { registerAuthApiRoutes } from './routes/api/auth'
import { registerSharesApiRoutes } from './routes/api/shares'
import { registerShareAccessApiRoutes } from './routes/api/shareAccess'
import { registerKbApiRoutes } from './routes/api/kb'
import { registerKbChatApiRoutes } from './routes/api/kb-chat'
import path from 'path'
import fs from 'fs'

const isDev = process.env.NODE_ENV !== 'production'
const isTest = process.env.NODE_ENV === 'test'
const PORT = Number(process.env.PORT) || 3000
async function start() {
  const app = Fastify({ logger: false })

  await app.register(fastifyCookie)
  await app.register(import('@fastify/multipart'), { limits: { fileSize: 10_000_000_000 } })

  app.addHook('onRequest', authMiddleware)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    console.error(error)
    return reply.code(500).send({ error: 'Internal Server Error' })
  })

  // JSON API routes
  registerFilesApiRoutes(app)
  registerSettingsApiRoutes(app)
  registerStatsApiRoutes(app)
  registerAuthApiRoutes(app)
  registerSharesApiRoutes(app)
  registerShareAccessApiRoutes(app)
  registerKbApiRoutes(app)
  registerKbChatApiRoutes(app)

  // HTTP routes (streaming, binary, SSE)
  registerMediaRoutes(app)
  registerThumbnailRoutes(app)
  registerDownloadRoutes(app)
  registerUploadRoutes(app)
  registerSSERoutes(app)
  registerShareMediaRoutes(app)

  if (isDev) {
    await app.register(import('@fastify/middie'))
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isTest ? { port: PORT + 1000 } : undefined,
        forwardConsole: false,
        watch: {
          ignored: [
            '**/test-media/**',
            '**/test-media-*/**',
            '**/test-data-*/**',
            '**/tests/fixtures/.auth/**',
            '**/tests/fixtures/test-config-*',
            '**/test-results/**',
            '**/playwright-report/**',
            '**/tests/**',
            // Persisted server data (often next to config.jsonc); writes trigger full-reload HMR otherwise
            '**/kb-chats.json',
            '**/shares.json',
            '**/settings.json',
            '**/stats.json',
          ],
        },
      },
      appType: 'custom',
      cacheDir: isTest
        ? `node_modules/.vite-test${process.env.BATCH_ID ? `-${process.env.BATCH_ID}` : ''}`
        : undefined,
    })
    app.use(vite.middlewares)

    const devIndexHtml = path.resolve('index.html')

    app.get('*', async (request, reply) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
        let template = fs.readFileSync(devIndexHtml, 'utf-8')
        template = await vite.transformIndexHtml(url.pathname, template)
        const dehydrated = await dehydrateForRoute(
          url.pathname,
          url.searchParams,
          (request.cookies as Record<string, string>) || {},
        )
        const html = template.replace(
          '<!--DEHYDRATED-->',
          `<script>window.__DEHYDRATED_STATE__=${dehydrated}</script>`,
        )
        reply.type('text/html').send(html)
      } catch (err) {
        console.error('Error serving HTML:', err)
        reply.code(500).send('Internal Server Error')
      }
    })
  } else {
    const staticRoot = 'dist/client'
    await app.register(import('@fastify/static'), {
      root: path.resolve(staticRoot),
      prefix: '/',
      wildcard: false,
    })

    const templateHtml = fs.readFileSync(path.resolve(staticRoot, 'index.html'), 'utf-8')

    app.get('*', async (request, reply) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
        const dehydrated = await dehydrateForRoute(
          url.pathname,
          url.searchParams,
          (request.cookies as Record<string, string>) || {},
        )
        const html = templateHtml.replace(
          '<!--DEHYDRATED-->',
          `<script>window.__DEHYDRATED_STATE__=${dehydrated}</script>`,
        )
        reply.type('text/html').send(html)
      } catch (err) {
        console.error('Error serving HTML:', err)
        reply.code(500).send('Internal Server Error')
      }
    })
  }

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`Server listening on http://localhost:${PORT}`)
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
