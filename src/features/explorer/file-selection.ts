import type { FileItem } from '@/lib/files/types'
export function selectFiles(
  selected: readonly string[],
  anchor: string | null,
  file: FileItem,
  ordered: readonly FileItem[],
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  toggle: boolean,
) {
  if (file.isVirtual) return { selected: [...selected], anchor }
  if (modifiers.shiftKey && anchor) {
    const start = ordered.findIndex((item) => item.path === anchor)
    const end = ordered.findIndex((item) => item.path === file.path)
    if (start !== -1 && end !== -1) {
      const range = ordered
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .filter((item) => !item.isVirtual)
        .map((item) => item.path)
      return {
        selected:
          modifiers.ctrlKey || modifiers.metaKey ? [...new Set([...selected, ...range])] : range,
        anchor,
      }
    }
  }
  return {
    selected:
      toggle || modifiers.ctrlKey || modifiers.metaKey
        ? selected.includes(file.path)
          ? selected.filter((p) => p !== file.path)
          : [...selected, file.path]
        : [file.path],
    anchor: file.path,
  }
}
