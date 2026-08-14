import { api } from './api'
import {
  canvasSaveRequest,
  parseCanvasCollection,
  type CanvasCollection,
} from './canvas-persistence'
import type { ContentWindowPersistencePort } from './content-window-persistence'

const CANVASES_PATH = '/api/canvases'

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
  return requireCanvasCollection(await api<unknown>(CANVASES_PATH), persistence)
}

export async function putCanvasCollection(
  collection: CanvasCollection,
  persistence: ContentWindowPersistencePort,
): Promise<CanvasCollection> {
  return requireCanvasCollection(
    await api<unknown>(CANVASES_PATH, {
      method: 'PUT',
      body: JSON.stringify(canvasSaveRequest(collection, persistence)),
    }),
    persistence,
  )
}
