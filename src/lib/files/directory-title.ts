/** Human-readable title for a server-relative directory; empty means the library root. */
export function directoryTitle(dir: string): string {
  const seg = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  return seg ?? 'Home'
}
