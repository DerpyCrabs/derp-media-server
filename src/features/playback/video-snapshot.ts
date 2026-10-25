import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { validImageSize } from '@/features/image-editor/image-transform'

export function snapshotName(path: string, position: number): string {
  const milliseconds = Math.max(0, Math.round(Number.isFinite(position) ? position * 1000 : 0))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds / 60_000) % 60
  const seconds = Math.floor(milliseconds / 1000) % 60
  const time = `${String(hours).padStart(2, '0')}-${String(minutes).padStart(2, '0')}-${String(seconds).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`
  let stem = fileNameFromPath(path).replace(/\.[^.]+$/, '') || 'Video'
  const encoder = new TextEncoder()
  const segments = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem),
    (part) => part.segment,
  )
  while (encoder.encode(stem).length > 180) {
    segments.pop()
    stem = segments.join('')
  }
  const directory = parentPath(path)
  return `${directory ? `${directory}/` : ''}${stem}-${time}.png`
}

export function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.readyState < 2 || video.seeking)
    throw new Error('Wait for the video frame to finish loading, then try again.')
  const width = video.videoWidth,
    height = video.videoHeight
  if (!validImageSize(width, height))
    throw new Error(
      'This frame is too large to capture. The limit is 40 megapixels and 16,384 pixels per side.',
    )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create an image of this frame.')
    context.drawImage(video, 0, 0, width, height)
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => {
        canvas.width = canvas.height = 1
        if (blob) resolve(blob)
        else reject(new Error('Could not encode this frame as PNG.'))
      }, 'image/png'),
    )
  } catch (error) {
    canvas.width = canvas.height = 1
    throw error
  }
}
