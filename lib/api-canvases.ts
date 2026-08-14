import { api } from './api'
import {
  canvasSaveRequest,
  parseCanvasCollection,
  type CanvasCollection,
} from './canvas-persistence'

const CANVASES_PATH = '/api/canvases'

function requireCanvasCollection(value: unknown): CanvasCollection {
  const document = parseCanvasCollection(value)
  if (!document) throw new Error('Server returned an invalid Canvas document')
  return document
}

export async function getCanvasCollection(): Promise<CanvasCollection> {
  return requireCanvasCollection(await api<unknown>(CANVASES_PATH))
}

export async function putCanvasCollection(collection: CanvasCollection): Promise<CanvasCollection> {
  return requireCanvasCollection(
    await api<unknown>(CANVASES_PATH, {
      method: 'PUT',
      body: JSON.stringify(canvasSaveRequest(collection)),
    }),
  )
}
