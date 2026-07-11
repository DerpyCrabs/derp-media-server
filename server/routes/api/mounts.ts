import type { FastifyInstance } from 'fastify'
import {
  addRuntimeMount,
  getRuntimeMounts,
  removeRuntimeMount,
  updateRuntimeMount,
} from '@/lib/config'
import { getAllShares } from '@/lib/shares'
import { promises as fs } from 'fs'

async function mountsResponse() {
  const shares = await getAllShares()
  return await Promise.all(
    getRuntimeMounts().map(async (mount) => {
      let status: 'online' | 'offline' = 'offline'
      try {
        if ((await fs.stat(mount.path)).isDirectory()) status = 'online'
      } catch {}
      return {
        ...mount,
        readOnly: true as const,
        status,
        shareCount: shares.filter((share) => share.rootId === mount.id).length,
      }
    }),
  )
}

export function registerMountsApiRoutes(app: FastifyInstance) {
  app.get('/api/admin/mounts', async (_request, reply) => {
    return reply.send({ mounts: await mountsResponse() })
  })

  app.post('/api/admin/mounts', async (request, reply) => {
    try {
      const body = request.body as { name?: unknown; path?: unknown }
      if (typeof body?.name !== 'string' || typeof body?.path !== 'string') {
        return reply.code(400).send({ error: 'name and path are required' })
      }
      const mount = await addRuntimeMount({ name: body.name, path: body.path })
      return reply.code(201).send({ mount: { ...mount, readOnly: true } })
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid mount' })
    }
  })

  app.patch('/api/admin/mounts/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as { name?: unknown; path?: unknown }
      if (typeof body?.name !== 'string' || typeof body?.path !== 'string') {
        return reply.code(400).send({ error: 'name and path are required' })
      }
      const mount = await updateRuntimeMount(id, { name: body.name, path: body.path })
      if (!mount) return reply.code(404).send({ error: 'Mount not found' })
      return reply.send({ mount: { ...mount, readOnly: true } })
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid mount' })
    }
  })

  app.delete('/api/admin/mounts/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await removeRuntimeMount(id))) return reply.code(404).send({ error: 'Mount not found' })
    return reply.send({ success: true })
  })
}
