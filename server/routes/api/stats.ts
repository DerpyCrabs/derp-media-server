import type { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import { config, getDataFilePath } from '@/lib/config'

const STATS_FILE = getDataFilePath('stats.json')

interface ViewStats {
  views: Record<string, number>
  shareViews: Record<string, number>
}

interface StatsFile {
  [mediaDir: string]: ViewStats
}

async function readAllStats(): Promise<StatsFile> {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function readStats(): Promise<ViewStats> {
  const allStats = await readAllStats()
  return allStats[config.mediaDir] || { views: {}, shareViews: {} }
}

async function writeStats(stats: ViewStats): Promise<void> {
  const allStats = await readAllStats()
  allStats[config.mediaDir] = stats
  await fs.writeFile(STATS_FILE, JSON.stringify(allStats, null, 2), 'utf-8')
}

export function registerStatsApiRoutes(app: FastifyInstance) {
  app.get('/api/stats/views', async (_request, reply) => {
    try {
      const stats = await readStats()
      return reply.send({ views: stats.views || {}, shareViews: stats.shareViews || {} })
    } catch {
      return reply.send({ views: {}, shareViews: {} })
    }
  })

  app.post('/api/stats/views', async (request, reply) => {
    const body = request.body as { filePath: string }

    if (!body.filePath) {
      return reply.code(400).send({ error: 'File path is required' })
    }

    const stats = await readStats()
    if (!stats.views) stats.views = {}

    stats.views[body.filePath] = (stats.views[body.filePath] || 0) + 1
    await writeStats(stats)
    return reply.send({ success: true, viewCount: stats.views[body.filePath] })
  })
}
