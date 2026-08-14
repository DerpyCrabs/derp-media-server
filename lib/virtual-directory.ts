import type {
  FileListResponse,
  VirtualAppearanceDto,
  VirtualCapabilityDto,
  VirtualDirectoryDto,
  VirtualEntryDto,
  VirtualOpenTargetDto,
} from './generated/api-contracts'
import type { FileItem } from './types'

export type VirtualCapability = VirtualCapabilityDto
export type VirtualOpenTarget = VirtualOpenTargetDto
export type VirtualAppearance = VirtualAppearanceDto
export type VirtualEntry = VirtualEntryDto
export type VirtualDirectory = VirtualDirectoryDto
export type DirectoryListing = FileListResponse

export function virtualAppearanceForPath(path: string): VirtualAppearance | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === 'Hermes Sessions') return { icon: 'agent-directory', tone: 'violet' }
  if (normalized === 'Hermes Sessions/archived') return { icon: 'archive', tone: 'muted' }
  if (normalized.startsWith('Hermes Sessions/project/')) return { icon: 'project', tone: 'indigo' }
  if (
    normalized.startsWith('Hermes Sessions/session/') ||
    normalized.startsWith('Hermes Sessions/draft/')
  ) {
    return { icon: 'agent-session', tone: 'violet' }
  }
  return undefined
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
