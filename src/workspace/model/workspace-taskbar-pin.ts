import type { FileItem } from '@/lib/files/types'
import type { TaskbarPin, TaskbarPinSource } from '@/lib/models/taskbar-pins'

type TaskbarPinTarget = {
  path: string
  source: TaskbarPinSource
}

function normalizePinPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
}

export function taskbarPinIdentity(target: TaskbarPinTarget): string {
  return JSON.stringify([
    target.source.kind,
    target.source.rootPath ? normalizePinPath(target.source.rootPath) : null,
    normalizePinPath(target.path),
  ])
}

export function taskbarPinLabel(pin: Pick<TaskbarPin, 'isDirectory' | 'path'>): string {
  return `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
}

export function createTaskbarPin(options: {
  file: FileItem
  source: TaskbarPinSource
  customIcons: Readonly<Record<string, string>>
}): TaskbarPin {
  const target = { path: normalizePinPath(options.file.path), source: options.source }
  return {
    id: `workspace-pin:${encodeURIComponent(taskbarPinIdentity(target))}`,
    path: target.path,
    isDirectory: options.file.isDirectory,
    title: options.file.name,
    customIconName:
      options.customIcons[options.file.path] ?? options.customIcons[target.path] ?? null,
    isVirtual: options.file.isVirtual,
    source: options.source,
  }
}

export function planTaskbarPinAdd(options: {
  pins: readonly TaskbarPin[]
  file: FileItem
  source: TaskbarPinSource
  customIcons: Readonly<Record<string, string>>
}): { kind: 'existing'; pinId: string } | { kind: 'add'; pin: TaskbarPin } {
  const pin = createTaskbarPin(options)
  const identity = taskbarPinIdentity(pin)
  const existing = options.pins.find((candidate) => taskbarPinIdentity(candidate) === identity)
  return existing ? { kind: 'existing', pinId: existing.id } : { kind: 'add', pin }
}
