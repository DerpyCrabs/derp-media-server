export type HostingPorts = { media: number; workspace: number }

declare global {
  interface Window {
    __HOSTING_PORTS__?: HostingPorts
  }
}

export function hostingUrl(surface: 'media' | 'workspace', pathname: string): string {
  if (typeof window === 'undefined') return pathname
  const configuredPort = window.__HOSTING_PORTS__?.[surface]
  if (!configuredPort) return pathname
  const url = new URL(pathname, window.location.origin)
  url.port = String(configuredPort)
  return url.href
}
