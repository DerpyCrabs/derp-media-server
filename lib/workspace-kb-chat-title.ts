/** Short display label for a knowledge-base root path (server-relative). */
export function workspaceKbRootDisplayName(kbRoot: string): string {
  const seg = kbRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  const s = seg?.trim()
  return s && s.length > 0 ? s : 'Knowledge base'
}

export function workspaceKbChatWindowTitle(kbRoot: string): string {
  return `${workspaceKbRootDisplayName(kbRoot)} Chat`
}
