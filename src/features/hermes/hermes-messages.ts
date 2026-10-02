import { Schema } from 'effect'
import { objectResponse } from './hermes-api'
import { type Snapshot } from 'effectweb'

import { extractHermesMessageImages } from './hermes-chat-parity'
import { type HermesMessage, type HermesToolCall } from './hermes-session-types'

function record(value: unknown): Record<string, unknown> {
  const decoded = Schema.decodeUnknownExit(objectResponse)(value)
  return decoded._tag === 'Success' ? decoded.value : {}
}
export function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const item = record(part)
          return typeof item.text === 'string'
            ? item.text
            : typeof item.content === 'string'
              ? item.content
              : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

export function displayValue(value: unknown): string {
  const text = messageText(value)
  if (text) return text
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return value instanceof Error ? value.message : ''
  }
}

export function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  return undefined
}

export function normalizeMessages(value: unknown): HermesMessage[] {
  if (!Array.isArray(value)) return []
  const messages = value.map((raw, index): HermesMessage => {
    const row = record(raw)
    const toolCalls = Array.isArray(row.tool_calls)
      ? row.tool_calls.map((call, callIndex): HermesToolCall => {
          const tool = record(call)
          const fn = record(tool.function)
          return {
            id: scalarString(tool.id) ?? `${scalarString(row.id) ?? index}-tool-${callIndex}`,
            name:
              scalarString(fn.name) ??
              scalarString(tool.name) ??
              scalarString(row.tool_name) ??
              'Unknown tool',
            arguments:
              typeof fn.arguments === 'string'
                ? fn.arguments
                : JSON.stringify(fn.arguments ?? tool.arguments ?? {}, null, 2),
          }
        })
      : undefined
    const media = extractHermesMessageImages(messageText(row.text ?? row.content))
    return {
      id:
        scalarString(row.id) ??
        scalarString(row.row_id) ??
        `${scalarString(row.timestamp) ?? 0}-${index}`,
      role: typeof row.role === 'string' ? row.role : 'assistant',
      text: media.text,
      images: media.images.length ? media.images : undefined,
      reasoning: messageText(row.reasoning_content ?? row.reasoning) || undefined,
      timestamp: typeof row.timestamp === 'number' ? row.timestamp : undefined,
      toolName: typeof row.tool_name === 'string' ? row.tool_name : undefined,
      toolCallId: typeof row.tool_call_id === 'string' ? row.tool_call_id : undefined,
      toolStatus: row.role === 'tool' ? 'complete' : undefined,
      inlineDiff: typeof row.inline_diff === 'string' ? row.inline_diff : undefined,
      toolCalls,
    }
  })
  const calls = new Map<string, HermesToolCall>()
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) calls.set(call.id, call)
  }
  return messages.filter((message) => {
    if (message.role !== 'tool' || !message.toolCallId) return true
    const call = calls.get(message.toolCallId)
    if (!call) return true
    call.result = message.text
    call.status = message.toolStatus ?? 'complete'
    call.inlineDiff = message.inlineDiff
    return false
  })
}

export function sameHermesMessages(
  left: readonly Snapshot<HermesMessage>[],
  right: readonly Snapshot<HermesMessage>[],
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((message, index) => JSON.stringify(message) === JSON.stringify(right[index]))
}
