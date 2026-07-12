import type { ShareLink } from '@/lib/shares'

export function buildShareUrl(
  share: Pick<ShareLink, 'token' | 'passcode'>,
  baseOrigin: string,
): string {
  const base = baseOrigin.trim().replace(/\/$/, '')
  const url = `${base}/share/${share.token}`
  return share.passcode ? `${url}?p=${encodeURIComponent(share.passcode)}` : url
}

export function getShareUrlWarning(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const localOnly =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    if (localOnly) {
      return 'This link uses a local-only address and will not be reachable from another device.'
    }
  } catch {
    return 'This link does not have a valid origin and may not be reachable from another device.'
  }
  return null
}

export async function copyShareUrl(url: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable')
  await navigator.clipboard.writeText(url)
}
