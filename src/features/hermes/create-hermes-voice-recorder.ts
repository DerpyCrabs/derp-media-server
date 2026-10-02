import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { HermesVoiceTransport } from './hermes-session-store'

type RecorderHandle = {
  state: () => RecordingState
  mimeType: () => string
  start: () => void
  stop: () => void
  detach: () => void
}

export type HermesVoiceRecorderDependencies = {
  getUserMedia: () => Promise<MediaStream>
  createRecorder: (
    stream: MediaStream,
    callbacks: { data: (blob: Blob) => void; stopped: () => void },
  ) => RecorderHandle
  schedule: (callback: () => void, delayMs: number) => number
  cancelSchedule: (timer: number) => void
  transcribe: (sessionKey: string, blob: Blob) => Effect.Effect<void, Error>
  reportError: (sessionKey: string, error: unknown) => void
}

const browserDependencies: HermesVoiceRecorderDependencies = {
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: (stream, callbacks) => {
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size) callbacks.data(event.data)
    }
    recorder.onstop = callbacks.stopped
    return {
      state: () => recorder.state,
      mimeType: () => recorder.mimeType,
      start: () => recorder.start(),
      stop: () => recorder.stop(),
      detach: () => {
        recorder.ondataavailable = null
        recorder.onstop = null
      },
    }
  },
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancelSchedule: (timer) => window.clearTimeout(timer),
  transcribe: HermesVoiceTransport.transcribe,
  reportError: HermesVoiceTransport.reportError,
}

const permissionSlot = 'microphone-permission'
const transcriptionSlot = 'voice-transcription'
type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'stopping'

export function createHermesVoiceRecorderEngine(
  options: { sessionKey: () => string; maxSeconds: () => number },
  dependencies: HermesVoiceRecorderDependencies,
) {
  const owner = modelOwner<{ phase: RecorderPhase; denied: boolean }>({
    phase: 'idle',
    denied: false,
  })
  const state = owner.read
  const setState = (
    next:
      | { phase: RecorderPhase; denied: boolean }
      | ((current: ReturnType<typeof state>) => { phase: RecorderPhase; denied: boolean }),
  ) => owner.patch(typeof next === 'function' ? next(state()) : next)
  let recorder: RecorderHandle | undefined
  let stream: MediaStream | undefined
  let timer: number | undefined
  let requestRevision = 0
  let disposed = false

  function clearTimer() {
    if (timer !== undefined) dependencies.cancelSchedule(timer)
    timer = undefined
  }

  function releaseMedia() {
    clearTimer()
    recorder?.detach()
    if (recorder?.state() !== 'inactive') recorder?.stop()
    recorder = undefined
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
  }

  function cancel() {
    requestRevision++
    owner.cancel(permissionSlot)
    releaseMedia()
    if (!disposed) setState((current) => ({ phase: 'idle', denied: current.denied }))
  }

  function dispose() {
    disposed = true
    requestRevision++
    owner.cancel(permissionSlot)
    releaseMedia()
    owner.dispose()
  }

  function toggle() {
    const phase = state().phase
    if (phase === 'requesting') {
      cancel()
      return
    }
    if (phase === 'recording') {
      if (!recorder || recorder.state() === 'inactive') {
        setState((current) => ({ ...current, phase: 'idle' }))
        return
      }
      setState((current) => ({ ...current, phase: 'stopping' }))
      recorder.stop()
      return
    }
    if (phase === 'stopping') return

    const request = ++requestRevision
    const recordingKey = options.sessionKey()
    setState({ phase: 'requesting', denied: false })
    let requestedStream: MediaStream | undefined
    let requestedRecorder: RecorderHandle | undefined
    owner.run(
      permissionSlot,
      Effect.gen(function* () {
        const nextStream = yield* Effect.callback<MediaStream, unknown>((resume) => {
          let interrupted = false
          try {
            void dependencies.getUserMedia().then(
              (acquired) => {
                if (interrupted) acquired.getTracks().forEach((track) => track.stop())
                else resume(Effect.succeed(acquired))
              },
              (error) => resume(Effect.fail(error)),
            )
          } catch (error) {
            resume(Effect.fail(error))
          }
          return Effect.sync(() => {
            interrupted = true
          })
        })
        requestedStream = nextStream
        if (disposed || request !== requestRevision) {
          nextStream.getTracks().forEach((track) => track.stop())
          return
        }
        stream = nextStream
        const chunks: Blob[] = []
        const nextRecorder: RecorderHandle = yield* Effect.try({
          try: () =>
            dependencies.createRecorder(nextStream, {
              data: (blob) => chunks.push(blob),
              stopped: () => {
                if (recorder !== nextRecorder) return
                clearTimer()
                nextRecorder.detach()
                recorder = undefined
                nextStream.getTracks().forEach((track) => track.stop())
                if (stream === nextStream) stream = undefined
                if (disposed) return
                setState((current) => ({ phase: 'idle', denied: current.denied }))
                const blob = new Blob(chunks, { type: nextRecorder.mimeType() || 'audio/webm' })
                if (blob.size) {
                  owner.run(
                    transcriptionSlot,
                    dependencies
                      .transcribe(recordingKey, blob)
                      .pipe(
                        Effect.catch((error) =>
                          Effect.sync(() => dependencies.reportError(recordingKey, error)),
                        ),
                      ),
                    'queue',
                  )
                }
              },
            }),
          catch: (error) => error,
        })
        requestedRecorder = nextRecorder
        recorder = nextRecorder
        yield* Effect.try({ try: () => nextRecorder.start(), catch: (error) => error })
        setState({ phase: 'recording', denied: false })
        timer = dependencies.schedule(() => {
          if (recorder === nextRecorder && nextRecorder.state() !== 'inactive') {
            setState((current) => ({ ...current, phase: 'stopping' }))
            nextRecorder.stop()
          }
        }, options.maxSeconds() * 1000)
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (recorder === requestedRecorder) recorder = undefined
            requestedRecorder?.detach()
            requestedStream?.getTracks().forEach((track) => track.stop())
            if (stream === requestedStream) stream = undefined
            if (disposed || request !== requestRevision) return
            const denied = error instanceof DOMException && error.name === 'NotAllowedError'
            setState({ phase: 'idle', denied })
            dependencies.reportError(recordingKey, error)
          }),
        ),
      ),
      'replace',
    )
  }

  return {
    source: owner.source,
    awaitIdle: owner.awaitIdle,
    read: owner.read,
    recording: () => state().phase === 'recording' || state().phase === 'stopping',
    denied: () => state().denied,
    toggle,
    cancel,
    dispose,
  }
}

export function createHermesVoiceRecorder(options: {
  sessionKey: () => string
  visible: () => boolean
  maxSeconds: () => number
}) {
  const engine = createHermesVoiceRecorderEngine(options, browserDependencies)

  return {
    ...engine,
    update: () => {
      if (!options.visible()) engine.cancel()
    },
  }
}
