import { describe, expect, test } from 'bun:test'
import {
  createHermesVoiceRecorderEngine,
  type HermesVoiceRecorderDependencies,
} from '@/features/hermes/create-hermes-voice-recorder'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function fakeStream(onStop: () => void): MediaStream {
  return {
    getTracks: () => [{ stop: onStop }],
  } as unknown as MediaStream
}

function recorderDependencies(options: {
  getUserMedia: () => Promise<MediaStream>
  onTranscribe?: (key: string, blob: Blob) => void
  onError?: (key: string, error: unknown) => void
  deferStop?: boolean
}) {
  let scheduled: (() => void) | undefined
  let stopped: (() => void) | undefined
  let detached = false
  let recorderState: RecordingState = 'inactive'
  let stopCalls = 0
  const dependencies: HermesVoiceRecorderDependencies = {
    getUserMedia: options.getUserMedia,
    createRecorder: (_stream, callbacks) => {
      stopped = callbacks.stopped
      callbacks.data(new Blob(['voice']))
      return {
        state: () => recorderState,
        mimeType: () => 'audio/webm',
        start: () => {
          recorderState = 'recording'
        },
        stop: () => {
          stopCalls++
          recorderState = 'inactive'
          if (!detached && !options.deferStop) callbacks.stopped()
        },
        detach: () => {
          detached = true
        },
      }
    },
    schedule: (callback) => {
      scheduled = callback
      return 1
    },
    cancelSchedule: () => {
      scheduled = undefined
    },
    transcribe: async (key, blob) => options.onTranscribe?.(key, blob),
    reportError: (key, error) => options.onError?.(key, error),
  }
  return {
    dependencies,
    runTimer: () => scheduled?.(),
    emitStopped: () => stopped?.(),
    stopCalls: () => stopCalls,
  }
}

describe('Hermes voice recorder', () => {
  test('cancels a pending permission request and releases its late stream', async () => {
    const permission = deferred<MediaStream>()
    let trackStops = 0
    const fake = recorderDependencies({ getUserMedia: () => permission.promise })
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => 'session-a', maxSeconds: () => 120 },
      fake.dependencies,
    )

    const starting = recorder.toggle()
    recorder.cancel()
    permission.resolve(fakeStream(() => trackStops++))
    await starting

    expect(recorder.recording()).toBe(false)
    expect(trackStops).toBe(1)
  })

  test('cancels active media without transcribing it', async () => {
    let trackStops = 0
    let transcriptions = 0
    const fake = recorderDependencies({
      getUserMedia: async () => fakeStream(() => trackStops++),
      onTranscribe: () => transcriptions++,
    })
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => 'session-a', maxSeconds: () => 120 },
      fake.dependencies,
    )

    await recorder.toggle()
    recorder.cancel()
    fake.emitStopped()

    expect(recorder.recording()).toBe(false)
    expect(trackStops).toBe(1)
    expect(transcriptions).toBe(0)
  })

  test('stops once at the timeout and transcribes against the starting session', async () => {
    let currentKey = 'session-a'
    let transcription: { key: string; size: number } | undefined
    const fake = recorderDependencies({
      getUserMedia: async () => fakeStream(() => undefined),
      onTranscribe: (key, blob) => {
        transcription = { key, size: blob.size }
      },
    })
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => currentKey, maxSeconds: () => 1 },
      fake.dependencies,
    )

    await recorder.toggle()
    currentKey = 'session-b'
    fake.runTimer()
    await Promise.resolve()

    expect(recorder.recording()).toBe(false)
    expect(transcription?.key).toBe('session-a')
    expect(transcription?.size).toBeGreaterThan(0)
  })

  test('ignores a second stop request while the first is settling', async () => {
    const fake = recorderDependencies({
      getUserMedia: async () => fakeStream(() => undefined),
      deferStop: true,
    })
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => 'session-a', maxSeconds: () => 120 },
      fake.dependencies,
    )

    await recorder.toggle()
    await Promise.all([recorder.toggle(), recorder.toggle()])

    expect(fake.stopCalls()).toBe(1)
    fake.emitStopped()
    expect(recorder.recording()).toBe(false)
  })

  test('marks only permission rejection as microphone denial', async () => {
    const fake = recorderDependencies({
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError')
      },
    })
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => 'session-a', maxSeconds: () => 120 },
      fake.dependencies,
    )

    await recorder.toggle()

    expect(recorder.denied()).toBe(true)
  })

  test('releases media and remains retryable when recorder construction fails', async () => {
    let trackStops = 0
    let reported: unknown
    const dependencies = recorderDependencies({
      getUserMedia: async () => fakeStream(() => trackStops++),
      onError: (_key, error) => {
        reported = error
      },
    }).dependencies
    dependencies.createRecorder = () => {
      throw new Error('unsupported codec')
    }
    const recorder = createHermesVoiceRecorderEngine(
      { sessionKey: () => 'session-a', maxSeconds: () => 120 },
      dependencies,
    )

    await recorder.toggle()

    expect(trackStops).toBe(1)
    expect(recorder.denied()).toBe(false)
    expect(reported).toBeInstanceOf(Error)
  })
})
