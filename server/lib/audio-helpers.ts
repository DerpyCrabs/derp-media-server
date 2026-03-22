import { statSync } from 'fs'
import { spawn } from 'child_process'
import { parseFile } from 'music-metadata'
import type { FastifyRequest, FastifyReply } from 'fastify'
import path from 'path'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']

export async function extractAudioMetadata(fullPath: string) {
  const metadata = await parseFile(fullPath)

  let coverArt: string | null = null
  if (metadata.common.picture && metadata.common.picture.length > 0) {
    const picture = metadata.common.picture[0]
    const base64 = Buffer.from(picture.data).toString('base64')
    coverArt = `data:${picture.format};base64,${base64}`
  }

  return {
    title: metadata.common.title || null,
    artist: metadata.common.artist || null,
    album: metadata.common.album || null,
    year: metadata.common.year || null,
    genre: metadata.common.genre || null,
    duration: metadata.format.duration || null,
    coverArt,
    trackNumber: metadata.common.track?.no || null,
    albumArtist: metadata.common.albumartist || null,
  }
}

export async function extractAudioTrack(
  fullPath: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const stats = statSync(fullPath)
  if (!stats.isFile()) {
    return reply.status(400).send({ error: 'Not a file' })
  }

  const extension = path.extname(fullPath).slice(1).toLowerCase()
  if (!VIDEO_EXTENSIONS.includes(extension)) {
    return reply.status(400).send({ error: 'Not a video file' })
  }

  const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let errorOutput = ''

    const ffmpeg = spawn(
      'ffmpeg',
      ['-i', fullPath, '-vn', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else {
        console.error(`FFmpeg exited with code ${code}`)
        console.error('FFmpeg stderr:', errorOutput)
        reject(new Error(`FFmpeg failed with code ${code}`))
      }
    })

    ffmpeg.on('error', reject)
  })

  const range = request.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : audioBuffer.length - 1
    const chunkSize = end - start + 1

    reply.raw.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${audioBuffer.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/webm',
      'Cache-Control': 'public, max-age=3600',
    })
    reply.raw.end(audioBuffer.subarray(start, end + 1))
    return reply
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'audio/webm',
    'Content-Length': audioBuffer.length,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  })
  reply.raw.end(audioBuffer)
  return reply
}
