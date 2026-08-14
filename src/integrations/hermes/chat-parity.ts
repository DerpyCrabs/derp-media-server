export type HermesCompletionItem = { text: string; display?: string; meta?: string; kind?: string }

export const HERMES_CLIENT_COMMANDS: HermesCompletionItem[] = [
  { text: '/title ', meta: 'Rename current chat', kind: 'client' },
  { text: '/branch ', meta: 'Branch current chat', kind: 'client' },
  { text: '/export', meta: 'Export transcript JSON', kind: 'client' },
  { text: '/retry', meta: 'Retry last turn', kind: 'client' },
  { text: '/stop', meta: 'Stop active turn', kind: 'client' },
  { text: '/model ', meta: 'Select model', kind: 'client' },
  { text: '/reasoning ', meta: 'Set reasoning effort', kind: 'client' },
  { text: '/fast', meta: 'Toggle Fast mode', kind: 'client' },
  { text: '/voice', meta: 'Voice controls', kind: 'client' },
]

const UNSUPPORTED_SHELL_COMMANDS = new Set([
  'clear',
  'exit',
  'quit',
  'resume',
  'sessions',
  'history',
  'settings',
  'theme',
  'terminal',
  'shell',
  'update',
  'restart',
  'plugins',
  'plugin',
])

function commandName(text: string) {
  return text.trim().split(/\s/, 1)[0]?.replace(/^\//, '').toLowerCase() ?? ''
}

export function filterHermesCompletions(
  query: string,
  gatewayItems: HermesCompletionItem[],
): HermesCompletionItem[] {
  const prefix = query.trim().toLowerCase()
  const combined = [...HERMES_CLIENT_COMMANDS, ...gatewayItems]
  const seen = new Set<string>()
  return combined.filter((item) => {
    if (!item.text.startsWith('/') || UNSUPPORTED_SHELL_COMMANDS.has(commandName(item.text)))
      return false
    if (prefix && !item.text.toLowerCase().startsWith(prefix)) return false
    const key = commandName(item.text)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function unsupportedHermesCommand(text: string): string | undefined {
  if (!text.trimStart().startsWith('/')) return undefined
  const name = commandName(text)
  return UNSUPPORTED_SHELL_COMMANDS.has(name)
    ? `/${name} is unavailable because this chat has no Hermes shell or sidebar surface`
    : undefined
}

export type HermesToolKind =
  | 'command'
  | 'changes'
  | 'search'
  | 'tasks'
  | 'image'
  | 'delegation'
  | 'file'
  | 'generic'

export function classifyHermesTool(name: string): HermesToolKind {
  const value = name.toLowerCase()
  if (/shell|terminal|exec|command/.test(value)) return 'command'
  if (/diff|patch/.test(value)) return 'changes'
  if (/search|grep|find|web/.test(value)) return 'search'
  if (/todo|task/.test(value)) return 'tasks'
  if (/image|screenshot/.test(value)) return 'image'
  if (/delegate|subagent|agent/.test(value)) return 'delegation'
  if (/file|read|write|edit/.test(value)) return 'file'
  return 'generic'
}

export function voiceControlGates(input: {
  transcription: boolean
  playback: boolean
  mediaRecorder: boolean
  microphoneApi: boolean
  permissionDenied: boolean
}) {
  return {
    record: input.transcription && input.mediaRecorder && input.microphoneApi,
    recordDisabled: input.permissionDenied,
    playback: input.playback,
  }
}

export function rewindTarget(
  messages: readonly { id: string; role: string }[],
  messageId: string,
): { index: number; userOrdinal: number } | undefined {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0 || messages[index]?.role !== 'user') return undefined
  return {
    index,
    userOrdinal: messages.slice(0, index).filter((message) => message.role === 'user').length,
  }
}

const HERMES_IMAGE_REF_LINE = /^@image:(?:`([^`]+)`|([^\n]+))\n?/gm
const HERMES_SCREENSHOT_LINE = /^\[screenshot\]\n?/gm
const HERMES_DATA_IMAGE = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g

export function extractHermesMessageImages(text: string): { text: string; images: string[] } {
  const images: string[] = []
  let cleaned = text.replace(HERMES_IMAGE_REF_LINE, (_match, quoted, plain) => {
    const value = String(quoted ?? plain ?? '').trim()
    if (value) images.push(value)
    return ''
  })
  cleaned = cleaned.replace(HERMES_DATA_IMAGE, (value) => {
    images.push(value)
    return ''
  })
  if (images.length) cleaned = cleaned.replace(HERMES_SCREENSHOT_LINE, '')
  return {
    text: cleaned
      .replace(
        /\{\s*"type"\s*:\s*"image_url"\s*,\s*"image_url"\s*:\s*\{\s*"url"\s*:\s*""\s*\}\s*\}/g,
        '',
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    images: [...new Set(images)],
  }
}

export function hermesImageUrl(source: string): string | null {
  const value = source.trim()
  if (/^data:image\/[\w.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value)) return value
  if (!value || /[\r\n]/.test(value)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null
  return hermesMediaUrl(value)
}
import { hermesMediaUrl } from './transport'
