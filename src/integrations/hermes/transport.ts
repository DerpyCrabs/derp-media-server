const HERMES_API_ROOT = '/api/hermes'

export const hermesTransportRoutes = {
  archive: `${HERMES_API_ROOT}/archive`,
  branch: `${HERMES_API_ROOT}/branch`,
  capabilities: `${HERMES_API_ROOT}/capabilities`,
  decision: `${HERMES_API_ROOT}/decision`,
  events: `${HERMES_API_ROOT}/events`,
  modelOptions: `${HERMES_API_ROOT}/model-options`,
  reference: `${HERMES_API_ROOT}/reference`,
  rename: `${HERMES_API_ROOT}/rename`,
  restore: `${HERMES_API_ROOT}/restore`,
  rewind: `${HERMES_API_ROOT}/rewind`,
  speak: `${HERMES_API_ROOT}/speak`,
  steer: `${HERMES_API_ROOT}/steer`,
  stop: `${HERMES_API_ROOT}/stop`,
  transcribe: `${HERMES_API_ROOT}/transcribe`,
  turn: `${HERMES_API_ROOT}/turn`,
} as const

export function hermesCompletionsUrl(parameters: URLSearchParams): string {
  return `${HERMES_API_ROOT}/completions?${parameters}`
}

export function hermesMediaUrl(path: string): string {
  return `${HERMES_API_ROOT}/media?${new URLSearchParams({ path })}`
}

export function hermesSessionUrl(sessionId: string): string {
  return `${HERMES_API_ROOT}/sessions/${encodeURIComponent(sessionId)}`
}

export function hermesSessionMessagesUrl(sessionId: string, limit: number, offset: number): string {
  return `${hermesSessionUrl(sessionId)}/messages?${new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })}`
}
