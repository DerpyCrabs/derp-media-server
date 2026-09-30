import {
  available,
  collection,
  domBinding,
  list,
  modelOwner,
  view,
  type Snapshot,
  controllerView,
  type ControllerModel,
} from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { PlaybackScrubber } from '@/features/playback/create-playback-scrubber'
import Download from '@effectweb/lucide/icons/download'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import Music2 from '@effectweb/lucide/icons/music-2'
import Pause from '@effectweb/lucide/icons/pause'
import Play from '@effectweb/lucide/icons/play'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import VolumeX from '@effectweb/lucide/icons/volume-x'
import { MediaType, type FileItem } from '@/lib/files/types'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { buildAdminMediaUrl, buildAudioMetadataUrl } from '@/lib/media/build-media-url'
import {
  audioPlaybackQueueFromFiles,
  type AudioMetadata,
  fetchAudioMetadataEffect,
  formatPlaybackTime,
  playbackItemFromPath,
  playbackPathKey,
  playbackPathMatches,
  playbackQueuesEqual,
} from '@/features/playback'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { observeQuery, query } from '@effectweb/query'
type Props = {
  viewingPath: string
  directory: string
  files: readonly FileItem[]
  contentVisible: boolean
  autoLoadPaused: boolean
  onNavigate: (path: string) => void
  onActivate?: () => void
}
const metadataQuery = query({
  name: 'audio-viewer-metadata',
  staleTime: Infinity,
  load: (path: string) => fetchAudioMetadataEffect(buildAudioMetadataUrl(path)),
})
const audioFiles = (props: Snapshot<Props>) =>
  props.files.filter((file) => file.type === MediaType.AUDIO)
const queueFor = (props: Snapshot<Props>) => {
  const items = audioPlaybackQueueFromFiles([...audioFiles(props)])
  return !props.viewingPath || items.some((item) => playbackPathMatches(item, props.viewingPath))
    ? items
    : [...items, playbackItemFromPath(props.viewingPath, 'audio')]
}
function audioController(props: Snapshot<Props>) {
  const session = getPlaybackSession()
  let offeredPath = ''
  const owner = modelOwner({
    props,
    playback: playbackSource.model(),
    metadata: undefined as AudioMetadata | undefined,
    size: { width: 576, height: 256 },
  })
  const actions = {
    resize: (size: { width: number; height: number }) => owner.patch({ size }),
    toggle: () => {
      const current = owner.read()
      if (!current.props.viewingPath) return
      current.props.onActivate?.()
      if (active()) session.dispatch({ type: 'toggle' })
      else load(current.props.viewingPath, true)
    },
    seek: (time: number) => {
      const current = owner.read()
      if (!Number.isFinite(time) || !current.props.viewingPath) return
      current.props.onActivate?.()
      if (active()) session.dispatch({ type: 'seek', position: time })
      else load(current.props.viewingPath, false, time)
    },
    select: (path: string) => {
      const current = owner.read(),
        controlled = active()
      current.props.onActivate?.()
      current.props.onNavigate(path)
      if (controlled) load(path, false)
    },
    mute: () => {
      session.dispatch({ type: 'setMuted', muted: !session.getSnapshot().muted })
    },
    volume: (volume: number) => {
      session.dispatch({ type: 'setVolume', volume })
    },
    retry: () => {
      session.dispatch({ type: 'retry' })
    },
  }
  const active = () => {
    const current = owner.read()
    return (
      current.playback.mode === 'audio' &&
      current.playback.currentItem?.media === 'audio' &&
      playbackPathMatches(current.playback.currentItem, current.props.viewingPath)
    )
  }
  const load = (path: string, autoplay: boolean, position?: number) => {
    const queue = queueFor(owner.read().props)
    session.dispatch({
      type: 'load',
      item:
        queue.find((item) => playbackPathMatches(item, path)) ??
        playbackItemFromPath(path, 'audio'),
      queue,
      autoplay,
      mode: 'audio',
      ...(position === undefined ? {} : { position }),
    })
  }
  const sync = () => {
    const current = owner.read(),
      props = current.props,
      key = props.viewingPath ? playbackPathKey(props.viewingPath) : ''
    if (props.autoLoadPaused && props.viewingPath && props.contentVisible && offeredPath !== key) {
      offeredPath = key
      if (!current.playback.currentItem) load(props.viewingPath, false)
    }
    const queue = queueFor(props)
    if (
      active() &&
      queue.length &&
      current.playback.currentItem &&
      !current.playback.queueContext &&
      !playbackQueuesEqual([...current.playback.queue], queue)
    )
      session.dispatch({ type: 'setQueue', queue, current: current.playback.currentItem })
  }
  owner.own(
    playbackSource.subscribe((playback) => {
      owner.patch({ playback })
      sync()
    }),
  )
  const metadata = observeQuery(owner, queryCache, metadataQuery, 'metadata', available)
  metadata.select(props.viewingPath || undefined)
  sync()
  return {
    source: owner.source,
    actions,
    receive: (next: Snapshot<Props>) => {
      owner.patch({ props: next })
      metadata.select(next.viewingPath || undefined)
      sync()
    },
    dispose: owner.dispose,
  }
}
type Model = ControllerModel<typeof audioController>
const resizeSurface = (
  element: HTMLDivElement,
  current: () => (size: { width: number; height: number }) => void,
) => {
  const measure = () => {
    const bounds = element.getBoundingClientRect()
    current()({ width: bounds.width, height: bounds.height })
  }
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  measure()
  return () => observer.disconnect()
}
const Artwork = view<{ url: string | null | undefined; class: string }>((props) => (
  <div
    class={`ring-border/70 relative shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-md ring-1 ${props.class}`}
  >
    {props.url ? (
      <img src={props.url} alt='Album art' class='h-full w-full object-cover' />
    ) : (
      <div class='flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-950 to-neutral-950'>
        <Music2 class='h-8 w-8 text-fuchsia-300/80' stroke-width={1.5} />
      </div>
    )}
  </div>
))
const Info = view<{ model: Model; compact?: boolean; duration: number }>((props) => {
  const model = props.model,
    fileName = model.props.viewingPath.split(/[/\\]/).pop() ?? 'file'
  return (
    <div class='min-w-0'>
      <h2
        class={`truncate font-semibold leading-tight text-foreground ${props.compact ? 'text-sm' : 'text-lg'}`}
        title={model.metadata?.title || fileName}
      >
        {model.metadata?.title || fileName}
      </h2>
      <p class='mt-0.5 truncate text-xs text-muted-foreground'>
        {model.metadata?.artist || 'Unknown artist'}
      </p>
      {!props.compact ? (
        <>
          <p class='truncate text-[11px] text-muted-foreground/75'>
            {model.metadata?.album || model.props.directory || 'Unknown album'}
          </p>
          <div class='mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground'>
            <span class='rounded bg-muted px-1.5 py-0.5 font-medium'>
              {model.props.viewingPath.split('.').pop()?.toUpperCase()}
            </span>
            <span class='rounded bg-muted px-1.5 py-0.5 tabular-nums'>
              {formatPlaybackTime(props.duration)}
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
})
const Transport = view<{ model: Model; active: boolean }>((props) => {
  const model = props.model,
    playing = props.active && model.playback.desiredPlaying
  return (
    <div class='flex min-w-0 items-center gap-2'>
      <button
        type='button'
        aria-label={playing ? 'Pause' : 'Play'}
        class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm'
        onClick={model.actions.toggle}
      >
        {playing ? <Pause class='size-4 fill-current' /> : <Play class='size-4 fill-current' />}
      </button>
      <button
        type='button'
        aria-label={model.playback.muted ? 'Unmute' : 'Mute'}
        class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
        onClick={model.actions.mute}
      >
        {model.playback.muted ? <VolumeX class='size-4' /> : <Volume2 class='size-4' />}
      </button>
      <input
        type='range'
        aria-label='Volume'
        min={0}
        max={1}
        step={0.01}
        value={model.playback.muted ? 0 : model.playback.volume}
        onInput={(event) => model.actions.volume(Number.parseFloat(event.currentTarget.value))}
        class='[&::-webkit-slider-thumb]:bg-foreground h-1.5 min-w-10 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
      />
      <a
        href={fileDownloadHref(model.props.viewingPath)}
        download={model.props.viewingPath.split(/[/\\]/).pop()}
        aria-label='Download'
        title='Download'
        class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
      >
        <Download class='size-4' />
      </a>
    </div>
  )
})
type RowProps = { file: FileItem; selected: boolean; onSelect: (path: string) => void }
const PlaylistRow = controllerView({
  create: (props: Snapshot<RowProps>) => {
    const owner = modelOwner({ props, metadata: undefined as AudioMetadata | undefined })
    const metadata = observeQuery(owner, queryCache, metadataQuery, 'metadata', available)
    metadata.select(props.file.path)
    return {
      source: owner.source,
      receive: (next: Snapshot<RowProps>) => {
        owner.patch({ props: next })
        metadata.select(next.file.path)
      },
      dispose: owner.dispose,
    }
  },
  view: view((model) => {
    const title = model.metadata?.title?.trim() || model.props.file.name
    const label = model.metadata?.artist?.trim() ? `${model.metadata.artist} — ${title}` : title
    return (
      <button
        type='button'
        data-audio-playlist-path={model.props.file.path}
        class={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted ${model.props.selected ? 'bg-primary/10 text-primary' : ''}`}
        onClick={() => model.props.onSelect(model.props.file.path)}
      >
        <Music2 class='size-3.5 shrink-0' />
        <span class='min-w-0 flex-1 truncate text-xs' title={label}>
          {label}
        </span>
      </button>
    )
  }),
})
const fileRows = collection<FileItem>((file) => file.path)
export const AudioViewerPane = controllerView({
  create: audioController,
  view: view((model) => {
    const props = model.props
    const layout =
      model.size.width >= 640 && model.size.height >= 236
        ? 'expanded'
        : model.size.width < 480 || model.size.height < 230
          ? 'compact'
          : 'standard'
    const active =
      model.playback.mode === 'audio' &&
      model.playback.currentItem?.media === 'audio' &&
      playbackPathMatches(model.playback.currentItem, props.viewingPath)
    const duration = (active ? model.playback.duration : 0) || model.metadata?.duration || 0
    const position = active ? model.playback.position : 0
    const cover = props.files.find(
      (file) =>
        file.type === MediaType.IMAGE &&
        ['cover', 'folder'].includes(file.name.toLowerCase().replace(/\.[^.]+$/, '')),
    )
    const artwork = model.metadata?.coverArt || (cover ? buildAdminMediaUrl(cover.path) : null)
    const error = active ? model.playback.error : null
    const seek = (
      <div class='flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground'>
        <span class='w-8 text-right tabular-nums'>{formatPlaybackTime(position)}</span>
        <PlaybackScrubber
          itemKey={props.viewingPath}
          position={position}
          duration={duration}
          onSeek={model.actions.seek}
          ariaLabel='Playback position'
          class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <span class='w-8 tabular-nums'>{formatPlaybackTime(duration)}</span>
      </div>
    )
    const standard = (
      <div class='grid h-full min-h-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-4 p-4'>
        <Artwork url={artwork} class='size-28' />
        <div class='min-w-0 space-y-2.5'>
          <Info model={model} duration={duration} />
          {seek}
          <Transport model={model} active={active} />
        </div>
      </div>
    )
    return (
      <div
        use={domBinding(model.actions.resize, resizeSurface)}
        data-testid='canvas-audio-player-ui'
        data-audio-layout={layout}
        class='relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-muted/45 via-background to-background'
      >
        {active && model.playback.phase === 'resolving' && !error ? (
          <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-sm'>
            <LoaderCircle class='h-7 w-7 animate-spin text-muted-foreground' stroke-width={2} />
          </div>
        ) : null}
        {error ? (
          <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center'>
            <p class='text-destructive text-sm'>{error}</p>
            <div class='flex gap-2'>
              <button
                type='button'
                class='rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                onClick={model.actions.retry}
              >
                Retry
              </button>
              <a
                href={fileDownloadHref(props.viewingPath)}
                download={props.viewingPath.split(/[/\\]/).pop()}
                class='rounded-md border border-input px-3 py-1.5 text-sm'
              >
                Download
              </a>
            </div>
          </div>
        ) : null}
        {layout === 'compact' ? (
          <div class='flex h-full min-h-0 flex-col justify-center gap-2.5 p-3'>
            <div class='flex min-w-0 items-center gap-3'>
              <Artwork url={artwork} class='size-12' />
              <div class='min-w-0 flex-1'>
                <Info model={model} compact duration={duration} />
              </div>
            </div>
            {seek}
            <Transport model={model} active={active} />
          </div>
        ) : layout === 'expanded' ? (
          <div class='grid h-full min-h-0 grid-cols-[minmax(0,1fr)_272px]'>
            {standard}
            <div
              data-testid='canvas-audio-playlist'
              class='flex h-full min-h-0 flex-col border-l border-border bg-muted/20'
            >
              <div class='border-b border-border px-3 py-2.5'>
                <p class='truncate text-[11px] text-muted-foreground'>{props.directory}</p>
              </div>
              <div class='min-h-0 flex-1 overflow-auto p-1.5'>
                {list(fileRows.from(audioFiles(props)), (file) => (
                  <PlaylistRow
                    file={file}
                    selected={file.path === props.viewingPath}
                    onSelect={model.actions.select}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          standard
        )}
      </div>
    )
  }),
})
