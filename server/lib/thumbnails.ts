import { spawn } from 'child_process'
import { readdirSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { FastifyReply } from 'fastify'
import sharp from 'sharp'
import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'

const CACHE_DIR = path.join(process.cwd(), '.thumbnails')

type GenerateThumbnail = (
  filePath: string,
  outputPath: string,
  signal: AbortSignal,
) => Promise<void>

type QueueWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abortListener?: () => void
}

type QueueJob = {
  filePath: string
  cachePath: string
  tempPath: string
  waiters: Set<QueueWaiter>
  controller: AbortController
  started: boolean
}

export class ThumbnailRequestAborted extends Error {
  constructor() {
    super('Thumbnail request aborted')
    this.name = 'AbortError'
  }
}

export function isThumbnailAbortError(error: unknown): boolean {
  return (
    error instanceof ThumbnailRequestAborted || (error as { name?: string })?.name === 'AbortError'
  )
}

function abortError() {
  return new ThumbnailRequestAborted()
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

const cachedThumbnailNamesByDir = new Map<string, Set<string>>()

function cachedThumbnails(dir: string) {
  const existing = cachedThumbnailNamesByDir.get(dir)
  if (existing) return existing
  try {
    const names = new Set(readdirSync(dir).filter((name) => name.endsWith('.jpg')))
    cachedThumbnailNamesByDir.set(dir, names)
    return names
  } catch {
    const names = new Set<string>()
    cachedThumbnailNamesByDir.set(dir, names)
    return names
  }
}

function cachePathExists(cachePath: string) {
  return cachedThumbnails(path.dirname(cachePath)).has(path.basename(cachePath))
}

function markCachePathExists(cachePath: string) {
  cachedThumbnails(path.dirname(cachePath)).add(path.basename(cachePath))
}

function getCacheKey(filePath: string, mtime: Date): string {
  const hash = Buffer.from(`${filePath}-${mtime.getTime()}`)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
  return `${hash}.jpg`
}

export function hasCachedThumbnail(filePath: string, mtime: Date): boolean {
  return cachedThumbnails(CACHE_DIR).has(getCacheKey(filePath, mtime))
}

function thumbnailTempPath(cachePath: string) {
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${cachePath}.${id}.tmp.jpg`
}

async function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ stdout: string }> {
  if (options.signal?.aborted) throw abortError()

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (error: unknown, result?: { stdout: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) {
        reject(error)
      } else {
        resolve(result ?? { stdout })
      }
    }

    const onAbort = () => {
      child.kill()
      finish(abortError())
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error(`${command} timed out`))
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', finish)
    child.on('close', (code) => {
      if (settled) return
      if (code === 0) {
        finish(null, { stdout })
        return
      }
      finish(new Error(`${command} exited with code ${code}: ${stderr.trim()}`))
    })

    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

let ffmpegAvailable: boolean | null = null
async function checkFFmpeg(signal: AbortSignal): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    await runProcess('ffmpeg', ['-version'], { timeoutMs: 5000, signal })
    ffmpegAvailable = true
  } catch (error) {
    if (isThumbnailAbortError(error)) throw error
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

async function getVideoDuration(videoPath: string, signal: AbortSignal): Promise<number> {
  try {
    const { stdout } = await runProcess(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { timeoutMs: 5000, signal },
    )
    const duration = parseFloat(stdout.trim())
    return Number.isNaN(duration) ? 0 : duration
  } catch (error) {
    if (isThumbnailAbortError(error)) throw error
    return 0
  }
}

async function generateVideoThumbnail(
  videoPath: string,
  outputPath: string,
  signal: AbortSignal,
): Promise<void> {
  const hasFfmpeg = await checkFFmpeg(signal)
  if (!hasFfmpeg) throw new Error('ffmpeg not available')

  const duration = await getVideoDuration(videoPath, signal)
  const startTime = duration > 0 ? Math.min(duration * 0.05, 3.0) : 3.0

  await runProcess(
    'ffmpeg',
    [
      '-ss',
      String(startTime),
      '-i',
      videoPath,
      '-vf',
      "thumbnail=n=100,scale='min(300,iw)':-1",
      '-frames:v',
      '1',
      outputPath,
      '-y',
    ],
    { timeoutMs: 15000, signal },
  )
}

async function generateImageThumbnail(
  imagePath: string,
  outputPath: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortError()
  await sharp(imagePath, { pages: 1, animated: false, failOn: 'none' })
    .rotate()
    .resize({ width: 300, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outputPath)
  if (signal.aborted) {
    await fs.unlink(outputPath).catch(() => undefined)
    throw abortError()
  }
}

async function generateThumbnail(filePath: string, outputPath: string, signal: AbortSignal) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const mediaType = getMediaType(extension)
  if (mediaType === MediaType.IMAGE) {
    await generateImageThumbnail(filePath, outputPath, signal)
    return
  }
  if (mediaType === MediaType.VIDEO) {
    await generateVideoThumbnail(filePath, outputPath, signal)
    return
  }
  throw new Error('Unsupported thumbnail media type')
}

export class ThumbnailGenerationQueue {
  private activeJob: QueueJob | null = null
  private readonly jobs = new Map<string, QueueJob>()
  private readonly pending: QueueJob[] = []

  constructor(private readonly generate: GenerateThumbnail = generateThumbnail) {}

  getOrGenerate(filePath: string, cachePath: string, signal?: AbortSignal): Promise<void> {
    if (cachePathExists(cachePath)) return Promise.resolve()
    if (signal?.aborted) return Promise.reject(abortError())

    let job = this.jobs.get(cachePath)
    if (!job) {
      job = {
        filePath,
        cachePath,
        tempPath: thumbnailTempPath(cachePath),
        waiters: new Set(),
        controller: new AbortController(),
        started: false,
      }
      this.jobs.set(cachePath, job)
      this.pending.push(job)
    }

    const activeJob = job
    const promise = new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = { resolve, reject, signal }
      waiter.abortListener = () => {
        this.removeWaiter(activeJob, waiter, abortError())
      }
      signal?.addEventListener('abort', waiter.abortListener, { once: true })
      activeJob.waiters.add(waiter)
    })

    this.drain()
    return promise
  }

  private removeWaiter(job: QueueJob, waiter: QueueWaiter, error?: unknown) {
    if (!job.waiters.delete(waiter)) return
    if (waiter.abortListener) waiter.signal?.removeEventListener('abort', waiter.abortListener)
    if (error) waiter.reject(error)

    if (job.waiters.size > 0) return
    if (job.started) {
      job.controller.abort()
      return
    }

    const pendingIndex = this.pending.indexOf(job)
    if (pendingIndex !== -1) this.pending.splice(pendingIndex, 1)
    this.jobs.delete(job.cachePath)
  }

  private settleJob(job: QueueJob, error?: unknown) {
    for (const waiter of job.waiters) {
      if (waiter.abortListener) waiter.signal?.removeEventListener('abort', waiter.abortListener)
      if (error) {
        waiter.reject(error)
      } else {
        waiter.resolve()
      }
    }
    job.waiters.clear()
  }

  private drain() {
    if (this.activeJob) return

    while (this.pending.length > 0) {
      const job = this.pending.shift()!
      if (job.waiters.size === 0) continue
      this.runJob(job)
      return
    }
  }

  private async runJob(job: QueueJob) {
    this.activeJob = job
    job.started = true

    try {
      if (!cachePathExists(job.cachePath)) {
        await this.generate(job.filePath, job.tempPath, job.controller.signal)
        if (job.controller.signal.aborted) throw abortError()
        await fs.rename(job.tempPath, job.cachePath)
        markCachePathExists(job.cachePath)
      }
      this.settleJob(job)
    } catch (error) {
      this.settleJob(job, error)
    } finally {
      await fs.unlink(job.tempPath).catch(() => undefined)
      this.jobs.delete(job.cachePath)
      this.activeJob = null
      this.drain()
    }
  }
}

export const thumbnailGenerationQueue = new ThumbnailGenerationQueue()

export async function readThumbnail(filePath: string, mtime: Date, signal?: AbortSignal) {
  await ensureCacheDir()
  const cachePath = path.join(CACHE_DIR, getCacheKey(filePath, mtime))

  if (!cachePathExists(cachePath)) {
    await thumbnailGenerationQueue.getOrGenerate(filePath, cachePath, signal)
  }
  if (signal?.aborted) throw abortError()
  return fs.readFile(cachePath)
}

export const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

export function sendPlaceholder(reply: FastifyReply, maxAge: string) {
  reply.raw.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': PLACEHOLDER_PNG.length,
    'Cache-Control': maxAge,
  })
  reply.raw.end(PLACEHOLDER_PNG)
}

export function sendThumbnailData(reply: FastifyReply, data: Buffer) {
  reply.raw.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': data.length,
    'Cache-Control': 'public, max-age=31536000',
  })
  reply.raw.end(data)
}
