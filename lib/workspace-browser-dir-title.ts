/** Tab / chrome title for a workspace browser at this server-relative directory; empty means library root. */
export function workspaceBrowserDirTitle(dir: string): string {
  const seg = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  return seg ?? 'Home'
}
