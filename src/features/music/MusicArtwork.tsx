import { createEffect, createSignal, Show } from 'solid-js'
import Music2 from 'lucide-solid/icons/music-2'

const unavailableArtwork = new Set<string>()

export function MusicArtwork(props: { path?: string; hasArtwork?: boolean; class?: string }) {
  const [failed, setFailed] = createSignal(false)
  createEffect(
    () => props.path,
    () => {
      setFailed(false)
    },
  )
  return (
    <div
      class={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary/70 ${props.class ?? 'size-11'}`}
    >
      <Music2 class='h-auto w-1/3 min-w-5 max-w-12 text-muted-foreground/40' />
      <Show when={props.path && !failed() && !unavailableArtwork.has(props.path)}>
        <img
          src={`/api/music/artwork/${encodeURIComponent(props.path!)}`}
          loading='lazy'
          alt=''
          class='absolute inset-0 size-full object-cover'
          onError={() => {
            if (props.path) unavailableArtwork.add(props.path)
            setFailed(true)
          }}
        />
      </Show>
    </div>
  )
}
