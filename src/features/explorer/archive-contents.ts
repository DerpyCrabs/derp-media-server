import { Schema } from 'effect'
import { query } from '@effectweb/query'
import { apiSchemaEffect } from '@/lib/api/client'
import { groups } from '@/lib/api/cache'

export const archiveEntrySchema = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  directory: Schema.Boolean,
})
export type ArchiveEntry = typeof archiveEntrySchema.Type
export const archiveQuery = query({
  name: 'archive-contents',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(
      Schema.Struct({ entries: Schema.Array(archiveEntrySchema) }),
      `/api/files/archive?path=${encodeURIComponent(path)}`,
    ),
})
export function isArchivePath(path: string) {
  return !/\.fb2\.zip$/i.test(path) && /\.(zip|tar|tar\.gz|tgz|tar\.xz|txz)$/i.test(path)
}
export function archiveChildren(entries: readonly ArchiveEntry[], directory: string, filter = '') {
  const prefix = directory ? `${directory}/` : ''
  const search = filter.trim().toLocaleLowerCase()
  const children = new Map<string, ArchiveEntry>()
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix) || entry.path === directory) continue
    const relative = entry.path.slice(prefix.length)
    if (search) {
      if (relative.toLocaleLowerCase().includes(search)) children.set(entry.path, entry)
    } else {
      const slash = relative.indexOf('/')
      const path = slash < 0 ? entry.path : prefix + relative.slice(0, slash)
      if (!children.has(path) || slash < 0)
        children.set(path, slash < 0 ? entry : { path, size: 0, directory: true })
    }
  }
  return [...children.values()].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
}
