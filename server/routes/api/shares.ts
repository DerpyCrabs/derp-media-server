import type { FastifyInstance } from 'fastify'
import {
  createShare,
  getAllShares,
  deleteShare,
  updateShare,
  type ShareRestrictions,
} from '@/lib/shares'
import { isPathEditable } from '@/lib/file-system'
import { config } from '@/lib/config'

function parseRestrictions(
  raw:
    | {
        allowDelete?: boolean
        allowUpload?: boolean
        allowEdit?: boolean
        maxUploadBytes?: number
      }
    | undefined,
): ShareRestrictions | undefined {
  if (!raw) return undefined
  const restrictions: ShareRestrictions = {}
  if (typeof raw.allowDelete === 'boolean') restrictions.allowDelete = raw.allowDelete
  if (typeof raw.allowUpload === 'boolean') restrictions.allowUpload = raw.allowUpload
  if (typeof raw.allowEdit === 'boolean') restrictions.allowEdit = raw.allowEdit
  if (typeof raw.maxUploadBytes === 'number' && raw.maxUploadBytes >= 0)
    restrictions.maxUploadBytes = raw.maxUploadBytes
  return Object.keys(restrictions).length > 0 ? restrictions : undefined
}

export function registerSharesApiRoutes(app: FastifyInstance) {
  app.get('/api/shares', async (_request, reply) => {
    const shares = await getAllShares()
    return reply.send({ shares })
  })

  app.post('/api/shares', async (request, reply) => {
    const body = request.body as {
      path: string
      isDirectory: boolean
      editable?: boolean
      restrictions?: {
        allowDelete?: boolean
        allowUpload?: boolean
        allowEdit?: boolean
        maxUploadBytes?: number
      }
    }

    if (!body.path) {
      return reply.code(400).send({ error: 'Path is required' })
    }

    const shouldBeEditable =
      (body.editable ?? false) && (body.isDirectory ?? false) && isPathEditable(body.path)
    const restrictions = shouldBeEditable ? parseRestrictions(body.restrictions) : undefined

    const share = await createShare(
      body.path,
      body.isDirectory ?? false,
      shouldBeEditable,
      restrictions,
    )

    const base = config.shareLinkDomain ?? `${request.protocol}://${request.hostname}`
    const url = `${base}/share/${share.token}`

    return reply.send({ share, url })
  })

  app.put('/api/shares', async (request, reply) => {
    const body = request.body as {
      token: string
      restrictions?: {
        allowDelete?: boolean
        allowUpload?: boolean
        allowEdit?: boolean
        maxUploadBytes?: number
      }
      editable?: boolean
    }

    if (!body.token) {
      return reply.code(400).send({ error: 'Token is required' })
    }

    const restrictions = parseRestrictions(body.restrictions)
    const editableVal = body.editable

    if (!restrictions && editableVal === undefined) {
      return reply.code(400).send({ error: 'No valid updates provided' })
    }

    const share = await updateShare(body.token, {
      restrictions,
      editable: editableVal,
    })
    if (!share) {
      return reply.code(404).send({ error: 'Share not found' })
    }

    return reply.send({ share })
  })

  app.post('/api/shares/delete', async (request, reply) => {
    const body = request.body as { token: string }

    if (!body.token) {
      return reply.code(400).send({ error: 'Token is required' })
    }

    const deleted = await deleteShare(body.token)
    if (!deleted) {
      return reply.code(404).send({ error: 'Share not found' })
    }

    return reply.send({ success: true })
  })
}
