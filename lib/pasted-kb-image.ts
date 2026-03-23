/** Obsidian-style pasted image name: `Pasted image YYYYMMDDHHmmss.ext` */
export function formatObsidianPastedImageFileName(mimeType: string): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const mt = (mimeType || '').toLowerCase()
  let ext = 'png'
  if (mt === 'image/jpeg' || mt === 'image/jpg') ext = 'jpg'
  else if (mt === 'image/png') ext = 'png'
  else if (mt === 'image/gif') ext = 'gif'
  else if (mt === 'image/webp') ext = 'webp'
  return `Pasted image ${stamp}.${ext}`
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(binary)
}

export function spliceString(s: string, start: number, end: number, insert: string): string {
  return s.slice(0, start) + insert + s.slice(end)
}
