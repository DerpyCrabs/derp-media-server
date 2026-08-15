export function normalizeBookPath(value: string): string {
  const output: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') output.pop()
    else output.push(part)
  }
  return output.join('/')
}

export function resolveBookPath(baseFile: string, target: string): string {
  const clean = target.split('#', 1)[0] ?? ''
  if (!clean) return normalizeBookPath(baseFile)
  const directory = normalizeBookPath(baseFile).split('/').slice(0, -1).join('/')
  let decoded = clean
  try {
    decoded = decodeURIComponent(clean)
  } catch {}
  return normalizeBookPath(`${directory}/${decoded}`)
}

export function splitBookHref(value: string): { path: string; anchor?: string } {
  const [path, anchor] = value.split('#', 2)
  if (!anchor) return { path: path ?? '' }
  try {
    return { path: path ?? '', anchor: decodeURIComponent(anchor) }
  } catch {
    return { path: path ?? '', anchor }
  }
}
