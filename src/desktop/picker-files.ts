import type { PickerRequest } from './bridge'
import type { FileItem } from '@/lib/files/types'
function globMatches(name: string, pattern: string) {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else if (char === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1)
      source += pattern.slice(i, end + 1).replace(/^\[!/, '[^')
      i = end
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`).test(name)
  } catch {
    return name === pattern
  }
}

export function pickerFileVisible(
  file: FileItem,
  request: import('effectweb').Snapshot<PickerRequest> | undefined,
  filter: number,
) {
  if (!request || file.isDirectory) return true
  if (request.directory) return false
  const rules = request.filters[filter]?.rules
  return (
    !rules?.length ||
    rules.some((rule) => rule.patterns.some((pattern) => globMatches(file.name, pattern)))
  )
}
