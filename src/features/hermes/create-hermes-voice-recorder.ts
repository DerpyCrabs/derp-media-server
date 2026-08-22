import { createEffect, createSignal, onSettled, untrack, type Accessor } from 'solid-js'
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
  transcribe: (sessionKey: string, blob: Blob) => Promise<void>
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

type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'stopping'

export function createHermesVoiceRecorderEngine(
  options: { sessionKey: Accessor<string>; maxSeconds: Accessor<number> },
  dependencies: HermesVoiceRecorderDependencies,
) {
  const [state, setState] = createSignal<{ phase: RecorderPhase; denied: boolean }>({
    phase: 'idle',
    denied: false,
  })
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
    releaseMedia()
    if (!disposed) setState((current) => ({ phase: 'idle', denied: current.denied }))
  }

  function dispose() {
    disposed = true
    requestRevision++
    releaseMedia()
  }

  async function toggle() {
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
    try {
      const nextStream = await dependencies.getUserMedia()
      requestedStream = nextStream
      if (disposed || request !== requestRevision) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream = nextStream
      const chunks: Blob[] = []
      const nextRecorder = dependencies.createRecorder(nextStream, {
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
            void dependencies
              .transcribe(recordingKey, blob)
              .catch((error) => dependencies.reportError(recordingKey, error))
          }
        },
      })
      requestedRecorder = nextRecorder
      recorder = nextRecorder
      nextRecorder.start()
      setState({ phase: 'recording', denied: false })
      timer = dependencies.schedule(() => {
        if (recorder === nextRecorder && nextRecorder.state() !== 'inactive') {
          setState((current) => ({ ...current, phase: 'stopping' }))
          nextRecorder.stop()
        }
      }, options.maxSeconds() * 1000)
    } catch (error) {
      if (recorder === requestedRecorder) recorder = undefined
      requestedRecorder?.detach()
      requestedStream?.getTracks().forEach((track) => track.stop())
      if (stream === requestedStream) stream = undefined
      if (disposed || request !== requestRevision) return
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      setState({ phase: 'idle', denied })
      dependencies.reportError(recordingKey, error)
    }
  }

  return {
    recording: () => state().phase === 'recording' || state().phase === 'stopping',
    denied: () => state().denied,
    toggle,
    cancel,
    dispose,
  }
}

export function createHermesVoiceRecorder(options: {
  sessionKey: Accessor<string>
  visible: Accessor<boolean>
  maxSeconds: Accessor<number>
}) {
  const engine = createHermesVoiceRecorderEngine(options, browserDependencies)

  createEffect(
    () => options.visible(),
    (visible) => {
      if (!visible) untrack(engine.cancel)
    },
  )
  onSettled(() => engine.dispose)

  return {
    recording: engine.recording,
    denied: engine.denied,
    toggle: engine.toggle,
  }
}
