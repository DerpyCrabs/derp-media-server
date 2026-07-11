import type { FastifyInstance } from 'fastify'
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MAX_LIMIT,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MIN_QUERY_LENGTH,
  fileSearchCodePointLength,
  normalizeFileSearchText,
} from '@/lib/file-search'
import { fileSearchService } from '@/server/file-search-service'

export function registerFileSearchApiRoutes(app: FastifyInstance) {
  app.get('/api/files/search', async (request, reply) => {
    const { q, limit: rawLimit } = request.query as { q?: unknown; limit?: unknown }
    if (typeof q !== 'string') {
      return reply.code(400).send({ error: 'q must be a string' })
    }
    const query = q.trim()
    const length = fileSearchCodePointLength(normalizeFileSearchText(query))
    if (length < FILE_SEARCH_MIN_QUERY_LENGTH || length > FILE_SEARCH_MAX_QUERY_LENGTH) {
      return reply.code(400).send({
        error: `Query must contain ${FILE_SEARCH_MIN_QUERY_LENGTH}-${FILE_SEARCH_MAX_QUERY_LENGTH} characters`,
      })
    }
    if (rawLimit !== undefined && typeof rawLimit !== 'string' && typeof rawLimit !== 'number') {
      return reply.code(400).send({ error: 'limit must be a number' })
    }
    const parsedLimit = Number(rawLimit ?? FILE_SEARCH_DEFAULT_LIMIT)
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(FILE_SEARCH_MAX_LIMIT, Math.floor(parsedLimit)))
      : FILE_SEARCH_DEFAULT_LIMIT
    try {
      return reply.send(await fileSearchService.search(query, limit))
    } catch (error) {
      return reply
        .code(503)
        .send({ error: error instanceof Error ? error.message : 'File search unavailable' })
    }
  })

  app.get('/api/files/search/status', async (_request, reply) => {
    try {
      return reply.send(await fileSearchService.status())
    } catch (error) {
      return reply
        .code(503)
        .send({ error: error instanceof Error ? error.message : 'File search unavailable' })
    }
  })

  app.post('/api/files/search/reindex', async (request, reply) => {
    const body = (request.body ?? {}) as { mode?: unknown; rootId?: unknown }
    if (body.mode !== 'reconcile' && body.mode !== 'full') {
      return reply.code(400).send({ error: 'mode must be "reconcile" or "full"' })
    }
    if (body.rootId !== undefined && typeof body.rootId !== 'string') {
      return reply.code(400).send({ error: 'rootId must be a string' })
    }
    try {
      const result = await fileSearchService.reindex(body.mode, body.rootId)
      return reply.code(202).send(result)
    } catch (error) {
      return reply
        .code(503)
        .send({ error: error instanceof Error ? error.message : 'File search unavailable' })
    }
  })
}
