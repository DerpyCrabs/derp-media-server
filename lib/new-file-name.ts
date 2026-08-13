export function normalizeNewFilePath(path: string, inKnowledgeBase: boolean): string {
  if (inKnowledgeBase) return path.toLowerCase().endsWith('.md') ? path : `${path}.md`
  const name = path.replace(/\\/g, '/').split('/').at(-1) ?? path
  return name.includes('.') ? path : `${path}.txt`
}
