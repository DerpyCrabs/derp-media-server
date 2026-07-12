const MAX_THUMBNAIL_EDGE = 480
const DECODE_TIMEOUT_MS = 10_000

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Offline thumbnail decoding timed out')), DECODE_TIMEOUT_MS)
    operation.then(
      (value) => { window.clearTimeout(timeout); resolve(value) },
      (error: unknown) => { window.clearTimeout(timeout); reject(error) },
    )
  })
}

function canvasSize(width: number, height: number) {
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/jpeg', 0.82))
}

async function imageThumbnail(source: Blob): Promise<Blob | undefined> {
  const bitmap = await withTimeout(createImageBitmap(source))
  try {
    const size = canvasSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height)
    return await canvasBlob(canvas)
  } finally {
    bitmap.close()
  }
}

async function videoThumbnail(source: Blob): Promise<Blob | undefined> {
  const url = URL.createObjectURL(source)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'metadata'
  video.src = url
  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Could not decode offline video metadata'))
    }))
    const target = Number.isFinite(video.duration) ? Math.min(1, video.duration / 4) : 0
    await withTimeout(new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve()
      video.onerror = () => reject(new Error('Could not decode offline video frame'))
      video.currentTime = target
      if (target === 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve()
    }))
    const size = canvasSize(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d')?.drawImage(video, 0, 0, size.width, size.height)
    return await canvasBlob(canvas)
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export async function generateOfflineThumbnail(source: Blob, mediaType: string) {
  try {
    if (mediaType === 'image') return await imageThumbnail(source)
    if (mediaType === 'video') return await videoThumbnail(source)
  } catch {
    return undefined
  }
  return undefined
}
