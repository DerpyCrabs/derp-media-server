import type { ContentInstance } from '@/lib/domain/content'
import {
  ErrorBoundary,
  Show,
  Suspense,
  createMemo,
  createResource,
  type Accessor,
  type JSX,
} from 'solid-js'
import type { ContentMountResult, ContentRuntime } from './runtime'

export type ContentRuntimeViewProps = Readonly<{
  runtime: ContentRuntime
  instance: Accessor<ContentInstance | null | undefined>
  active?: Accessor<boolean>
  onReplace?: (instance: ContentInstance) => void
  onOpen?: (instance: ContentInstance) => void
  onClose?: () => void
  onFocus?: () => void
  loading?: JSX.Element
  unavailable?: (reason: string) => JSX.Element
}>

function DefaultUnavailable(props: { reason: string }) {
  return (
    <div role='alert' class='flex h-full min-h-0 items-center justify-center p-6 text-center'>
      <p class='text-sm text-muted-foreground'>Unable to open content: {props.reason}</p>
    </div>
  )
}

function MountedContent(props: {
  result: ContentMountResult
  unavailable: (reason: string) => JSX.Element
}) {
  if (!props.result.ok) return props.unavailable(props.result.reason)
  return (
    <ErrorBoundary fallback={(error) => props.unavailable(String(error))}>
      {props.result.render()}
    </ErrorBoundary>
  )
}

export function ContentRuntimeView(props: ContentRuntimeViewProps) {
  const source = createMemo(() => props.instance() ?? false)
  const mountKey = createMemo(() => {
    const instance = source()
    if (!instance) return false
    const resolution = props.runtime.resolve(instance)
    return resolution.ok
      ? `${instance.id}:${resolution.renderer.id}`
      : `${instance.id}:unavailable:${resolution.reason}`
  })
  const [mounted] = createResource(mountKey, () => {
    const initial = props.instance()
    if (!initial) throw new Error('Content instance unavailable')
    return props.runtime.mount(() => props.instance() ?? initial, {
      replace: (next) => props.onReplace?.(next),
      open: props.onOpen,
      close: props.onClose,
      focus: props.onFocus,
      active: props.active,
    })
  })
  const unavailable = (reason: string) =>
    props.unavailable?.(reason) ?? <DefaultUnavailable reason={reason} />

  return (
    <Show when={source()}>
      <Suspense fallback={props.loading}>
        <Show when={mounted()} keyed>
          {(result) => <MountedContent result={result} unavailable={unavailable} />}
        </Show>
      </Suspense>
    </Show>
  )
}
