import { navigate, parseRoute } from '@/src/lib/routes'

export function navigateShareWorkspaceToClassicPage(shareToken: string) {
  const sp = new URLSearchParams(window.location.search)
  sp.delete('ws')
  sp.delete('preset')
  const qs = sp.toString()
  navigate(parseRoute({ pathname: `/share/${shareToken}`, search: qs ? `?${qs}` : '' }))
}
