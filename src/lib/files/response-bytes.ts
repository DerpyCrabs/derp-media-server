export async function readResponseBytes(response: Response, limit: number): Promise<ArrayBuffer> {
  const tooLarge = () =>
    new Error(`File exceeds the ${Math.floor(limit / 1024 / 1024)} MB preview limit.`)
  const size = Number(response.headers.get('content-length'))
  if (Number.isFinite(size) && size > limit) {
    await response.body?.cancel()
    throw tooLarge()
  }
  if (!response.body) return new ArrayBuffer(0)
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}
