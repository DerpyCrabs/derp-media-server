export function navigateShareWorkspaceToClassicPage(shareToken: string) {
  const sp = new URLSearchParams(window.location.search)
  sp.delete('ws')
  sp.delete('preset')
  const qs = sp.toString()
  window.history.pushState(null, '', `/share/${shareToken}${qs ? `?${qs}` : ''}`)
}
