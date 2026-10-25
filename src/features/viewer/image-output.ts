import { validImageSize } from '@/features/image-editor/image-transform'

export async function imageOutput(
  path: string,
  rotation: number,
  signal: AbortSignal,
  maxSide = 16384,
) {
  const response = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, { signal })
  if (!response.ok) throw new Error('Could not load the original image.')
  const limit = 64 * 1024 * 1024
  const tooLarge = () =>
    new Error('This image is too large to prepare. Download the original instead.')
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw tooLarge()
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Could not load the original image.')
  const parts: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw tooLarge()
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const blob = new Blob(parts, {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  })
  signal.throwIfAborted()
  const url = URL.createObjectURL(blob)
  const image = new Image()
  const canvas = document.createElement('canvas')
  const abort = () => image.removeAttribute('src')
  signal.addEventListener('abort', abort, { once: true })
  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()
    if (!validImageSize(image.naturalWidth, image.naturalHeight))
      throw new Error(
        'Images up to 40 megapixels and 16,384 pixels per side are supported. Download the original instead.',
      )
    const sideways = rotation % 180 !== 0
    const width = sideways ? image.naturalHeight : image.naturalWidth
    const height = sideways ? image.naturalWidth : image.naturalHeight
    const scale = Math.min(1, maxSide / Math.max(width, height))
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')!
    context.translate(canvas.width / 2, canvas.height / 2)
    context.scale(scale, scale)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    const result = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Could not prepare the image.'))),
        'image/png',
      ),
    )
    signal.throwIfAborted()
    return { blob: result, width, height, outputWidth: canvas.width, outputHeight: canvas.height }
  } finally {
    signal.removeEventListener('abort', abort)
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
    canvas.width = canvas.height = 1
  }
}
