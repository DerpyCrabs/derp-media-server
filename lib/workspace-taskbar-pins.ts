import { filesystemResourceAddress, isResourceKey, type ResourceKey } from './domain/resource'

type WorkspaceTaskbarPinFields = Readonly<{
  id: string
  title: string
  customIconName?: string | null
}>

export type WorkspaceTaskbarPin = WorkspaceTaskbarPinFields & Readonly<{ resource: ResourceKey }>

function commonFields(value: Record<string, unknown>): WorkspaceTaskbarPinFields | null {
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    (value.customIconName !== undefined &&
      value.customIconName !== null &&
      typeof value.customIconName !== 'string')
  ) {
    return null
  }
  return {
    id: value.id,
    title: value.title,
    ...(value.customIconName === undefined ? {} : { customIconName: value.customIconName }),
  }
}

function parsePin(raw: unknown): WorkspaceTaskbarPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const allowedFields = new Set(['id', 'resource', 'title', 'customIconName'])
  if (Object.keys(value).some((field) => !allowedFields.has(field))) return null
  const common = commonFields(value)
  if (!common) return null

  if (!isResourceKey(value.resource)) return null
  return { ...common, resource: { ...value.resource } }
}

export function parseWorkspaceTaskbarPins(raw: unknown): WorkspaceTaskbarPin[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    const pin = parsePin(value)
    return pin ? [pin] : []
  })
}

export function serializeWorkspaceTaskbarPins(
  raw: readonly WorkspaceTaskbarPin[],
): WorkspaceTaskbarPin[] {
  return parseWorkspaceTaskbarPins(raw)
}

export function workspaceTaskbarPinPath(pin: WorkspaceTaskbarPin): string | null {
  return filesystemResourceAddress(pin.resource)?.path ?? null
}

export function workspaceTaskbarPinResource(pin: WorkspaceTaskbarPin): ResourceKey | null {
  return isResourceKey(pin.resource) ? pin.resource : null
}

export function workspaceTaskbarPinIdentity(pin: WorkspaceTaskbarPin): string {
  return `resource:${pin.resource.provider}:${pin.resource.id}`
}
