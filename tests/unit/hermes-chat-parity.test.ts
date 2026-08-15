import { describe, expect, test } from 'bun:test'
import {
  classifyHermesTool,
  extractHermesMessageImages,
  filterHermesCompletions,
  hermesImageUrl,
  rewindTarget,
  unsupportedHermesCommand,
  voiceControlGates,
} from '@/features/hermes/hermes-chat-parity'

describe('Hermes chat parity helpers', () => {
  test('merges client and gateway slash commands while excluding absent shell surfaces', () => {
    const items = filterHermesCompletions('/r', [
      { text: '/resume', meta: 'sidebar' },
      { text: '/research', meta: 'gateway skill' },
      { text: '/retry', meta: 'gateway duplicate' },
    ])
    expect(items.map((item) => item.text.trim())).toEqual(['/retry', '/reasoning', '/research'])
  })

  test('unknown tools remain generic and known tools get stable rich categories', () => {
    expect(classifyHermesTool('terminal.exec')).toBe('command')
    expect(classifyHermesTool('apply_patch')).toBe('changes')
    expect(classifyHermesTool('future_plugin_tool')).toBe('generic')
  })

  test('rejects pasted commands for missing shell surfaces explicitly', () => {
    expect(unsupportedHermesCommand('/resume abc')).toContain('no Hermes shell or sidebar')
    expect(unsupportedHermesCommand('/research topic')).toBeUndefined()
    expect(unsupportedHermesCommand('ordinary prompt')).toBeUndefined()
  })

  test('voice controls degrade independently and preserve denied state', () => {
    expect(
      voiceControlGates({
        transcription: true,
        playback: false,
        mediaRecorder: true,
        microphoneApi: true,
        permissionDenied: true,
      }),
    ).toEqual({ record: true, recordDisabled: true, playback: false })
    expect(
      voiceControlGates({
        transcription: false,
        playback: true,
        mediaRecorder: true,
        microphoneApi: true,
        permissionDenied: false,
      }),
    ).toEqual({ record: false, recordDisabled: false, playback: true })
  })

  test('edit and retry address stable visible user ordinals', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 't1', role: 'tool' },
      { id: 'u2', role: 'user' },
    ]
    expect(rewindTarget(messages, 'u2')).toEqual({ index: 3, userOrdinal: 1 })
    expect(rewindTarget(messages, 'a1')).toBeUndefined()
  })

  test('lifts Hermes image directives and screenshot placeholders out of message text', () => {
    expect(
      extractHermesMessageImages('@image:C:\\Hermes Images\\shot.png\nquestion\n[screenshot]'),
    ).toEqual({
      text: 'question',
      images: ['C:\\Hermes Images\\shot.png'],
    })
    expect(extractHermesMessageImages('@image:`/tmp/my shot.png`\nlook')).toEqual({
      text: 'look',
      images: ['/tmp/my shot.png'],
    })
    expect(hermesImageUrl('/tmp/a.png')).toBe('/api/hermes/media?path=%2Ftmp%2Fa.png')
    expect(hermesImageUrl('javascript:alert(1)')).toBeNull()
  })
})
