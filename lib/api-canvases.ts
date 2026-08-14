import { api } from './api'
import {
  canvasSaveRequest,
  parseCanvasCollection,
  type CanvasCollection,
} from './canvas-persistence'
import type { ContentWindowPersistencePort } from './content-window-persistence'
import { apiRoutes } from './generated/api-contracts'

function requireCanvasCollection(
  value: unknown,
  persistence: ContentWindowPersistencePort,
): CanvasCollection {
  const document = parseCanvasCollection(value, persistence)
  if (!document) throw new Error('Server returned an invalid Canvas document')
  return document
}

export async function getCanvasCollection(
  persistence: ContentWindowPersistencePort,
): Promise<CanvasCollection> {
  return requireCanvasCollection(await api<unknown>(apiRoutes.canvases), persistence)
}

export async function putCanvasCollection(
  collection: CanvasCollection,
  persistence: ContentWindowPersistencePort,
): Promise<CanvasCollection> {
  return requireCanvasCollection(
    await api<unknown>(apiRoutes.canvases, {
      method: 'PUT',
      body: JSON.stringify(canvasSaveRequest(collection, persistence)),
    }),
    persistence,
  )
}
