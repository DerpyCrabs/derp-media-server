export function workspaceBrowserPaneParentDir(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}
