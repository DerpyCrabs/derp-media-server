import type { ShareLink } from '@/lib/shares'

type SharePasscodeCapture = {
  token: string | null
  passcode: string | null
  sanitizedHref: string
  changed: boolean
}

const capturedPasscodes = new Map<string, string>()

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function stripPasscodeParam(value: string): { value: string; passcode: string | null } {
  let passcode: string | null = null
  const retained = value.split('&').filter((part) => {
    const separator = part.indexOf('=')
    const key = decodeParam(separator < 0 ? part : part.slice(0, separator))
    if (key !== 'p') return true
    passcode ??= decodeParam(separator < 0 ? '' : part.slice(separator + 1))
    return false
  })
  return { value: retained.join('&'), passcode }
}

function shareToken(pathname: string): string | null {
  const match = pathname.match(/^\/share\/([^/]+)(?:\/workspace\/?|\/?)$/)
  return match ? decodeParam(match[1]) : null
}

/**
 * Captures a share passcode without persisting it and returns a URL with every
 * secret removed. Fragment credentials win during the compatibility rollout.
 */
export function inspectSharePasscode(url: URL): SharePasscodeCapture {
  const token = shareToken(url.pathname)
  if (!token) {
    return { token: null, passcode: null, sanitizedHref: url.href, changed: false }
  }

  const query = stripPasscodeParam(url.search.slice(1))
  const fragment = stripPasscodeParam(url.hash.slice(1))
  const passcode = fragment.passcode ?? query.passcode
  if (query.passcode === null && fragment.passcode === null) {
    return { token, passcode: null, sanitizedHref: url.href, changed: false }
  }

  const sanitized = new URL(url.href)
  sanitized.search = query.value ? `?${query.value}` : ''
  sanitized.hash = fragment.value ? `#${fragment.value}` : ''
  return { token, passcode, sanitizedHref: sanitized.href, changed: true }
}

export function captureSharePasscodeFromLocation(): void {
  const capture = inspectSharePasscode(new URL(window.location.href))
  if (!capture.token || !capture.changed) return
  if (capture.passcode) capturedPasscodes.set(capture.token, capture.passcode)
  const sanitized = new URL(capture.sanitizedHref)
  window.history.replaceState(
    window.history.state,
    '',
    `${sanitized.pathname}${sanitized.search}${sanitized.hash}`,
  )
}

export function consumeCapturedSharePasscode(token: string): string {
  const passcode = capturedPasscodes.get(token) ?? ''
  capturedPasscodes.delete(token)
  return passcode
}

export function clearCapturedSharePasscodesForTests(): void {
  capturedPasscodes.clear()
}

export function buildShareUrl(
  share: Pick<ShareLink, 'token' | 'passcode'>,
  baseOrigin: string,
): string {
  const base = baseOrigin.trim().replace(/\/$/, '')
  const url = `${base}/share/${encodeURIComponent(share.token)}`
  return share.passcode ? `${url}#p=${encodeURIComponent(share.passcode)}` : url
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
