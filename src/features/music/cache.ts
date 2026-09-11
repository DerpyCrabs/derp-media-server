import type { QueryClient } from '@tanstack/solid-query'
import type { MusicHomeData, MusicTrack } from './types'

export function updateMusicFeedback(client: QueryClient, input: { path: string; kind: string }) {
  const update = (items: MusicTrack[]) =>
    items.flatMap((item) => {
      if (item.path !== input.path && !item.path.startsWith(`${input.path}/`)) return [item]
      if (input.kind === 'hide' || input.kind === 'later') return []
      return [{ ...item, liked: input.kind === 'more' }]
    })
  const updateSections = (sections: Pick<MusicHomeData, 'rows' | 'albums' | 'mixes'>) => ({
    ...sections,
    rows: sections.rows.map((row) => ({ ...row, items: update(row.items) })),
    albums: sections.albums.map((album) => ({ ...album, items: update(album.items) })),
    mixes: sections.mixes.map((mix) => {
      const items = update(mix.items)
      return { ...mix, items, count: items.length }
    }),
  })
  client.setQueriesData<MusicHomeData>({ queryKey: ['music', 'home'] }, (home) =>
    home
      ? {
          ...home,
          ...updateSections(home),
          radio: { ...home.radio, tracks: update(home.radio.tracks) },
          genreViews: Object.fromEntries(
            Object.entries(home.genreViews).map(([genre, sections]) => [
              genre,
              updateSections(sections),
            ]),
          ),
        }
      : home,
  )
}
