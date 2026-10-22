import { component, view } from 'effectweb'
import Music2 from '@effectweb/lucide/icons/music-2'
const unavailableArtwork = new Set<string>()
type Props = { path?: string; hasArtwork?: boolean; class?: string }
export const MusicArtwork = component<Props, { failed: boolean }>(
  {
    identity: (props) => props.path,
    init: (props) => ({ failed: !!props.path && unavailableArtwork.has(props.path) }),
  },
  view(({ props, failed }, patch) => (
    <div
      class={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary/70 ${props.class ?? 'size-11'}`}
    >
      <Music2 class='h-auto w-1/3 min-w-5 max-w-12 text-muted-foreground/40' />
      {props.path && !failed ? (
        <img
          src={`/api/music/artwork/${encodeURIComponent(props.path)}`}
          loading='lazy'
          alt=''
          class='absolute inset-0 size-full object-cover'
          onError={() => {
            if (props.path) unavailableArtwork.add(props.path)
            patch({ failed: true })
          }}
        />
      ) : null}
    </div>
  )),
)
