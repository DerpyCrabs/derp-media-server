import type { FileItem } from '@/lib/files/types'

export type VirtualCapability =
  | 'open'
  | 'createFile'
  | 'createFolder'
  | 'rename'
  | 'archive'
  | 'restore'
  | 'deletePermanently'
  | 'deleteProject'
  | 'download'
  | 'copyId'
  | 'branch'
  | 'moveToProject'
  | 'addProjectFolder'
  | 'removeProjectFolder'
  | 'setPrimaryFolder'
  | 'setAppearance'
  | 'pin'

export type VirtualOpenTarget = {
  provider: string
  type: string
  [key: string]: unknown
}

export type VirtualEntryAppearance = {
  icon: string
  tone: string
  color?: string
}

export type VirtualEntry = {
  provider: string
  kind: string
  id?: string
  archived?: boolean
  capabilities: VirtualCapability[]
  openTarget?: VirtualOpenTarget
  metadata?: Record<string, unknown>
  appearance?: VirtualEntryAppearance
}

export type VirtualDirectory = {
  provider: string
  kind: string
  path: string
  capabilities: VirtualCapability[]
  offset: number
  pageSize: number
  total: number
  nextOffset?: number
}

export type DirectoryListing = {
  files: FileItem[]
  virtualDirectory?: VirtualDirectory
  virtualEntries?: Record<string, VirtualEntry>
}

export function hasVirtualCapability(
  value: VirtualDirectory | VirtualEntry | undefined,
  capability: VirtualCapability,
): boolean {
  return value?.capabilities.includes(capability) ?? false
}

export function virtualFileSizeVisible(
  file: Pick<FileItem, 'isDirectory'>,
  entry?: VirtualEntry,
): boolean {
  return !file.isDirectory && !entry
}

export function virtualEntrySubtitle(entry?: VirtualEntry): string {
  if (!entry || entry.kind !== 'session') return ''
  const metadata = entry.metadata ?? {}
  const status = entry.archived
    ? 'Archived'
    : metadata.pending_approval === true
      ? 'Needs input'
      : metadata.error || metadata.last_error || metadata.status === 'error'
        ? 'Failed'
        : metadata.is_active === true || Number(metadata.queued_prompt_count) > 0
          ? 'Working'
          : ''
  const source = typeof metadata.source === 'string' ? metadata.source : ''
  const cwd =
    typeof metadata.cwd === 'string'
      ? (metadata.cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '')
      : ''
  const rawTime = Number(metadata.last_active ?? metadata.lastActive)
  const date =
    Number.isFinite(rawTime) && rawTime > 0
      ? new Date(rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime).toLocaleDateString(
          undefined,
          { month: 'short', day: 'numeric' },
        )
      : ''
  return [status, source, cwd, date].filter(Boolean).join(' · ')
}
