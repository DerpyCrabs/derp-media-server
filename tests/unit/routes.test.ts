import { describe, expect, test } from 'bun:test'
import {
  hrefFor,
  hrefForSurface,
  parseRoute,
  updateRouteSearch,
  type AppRouteKind,
} from '@/src/lib/routes'

describe('application routes', () => {
  const routeCases: Array<{
    href: string
    kind: AppRouteKind
    directory?: string
  }> = [
    { href: '/', kind: 'library', directory: '' },
    { href: '/?dir=Music', kind: 'library', directory: 'Music' },
    { href: '/workspace?dir=Documents&ws=desk-1&preset=reading', kind: 'workspace' },
    { href: '/canvas', kind: 'canvas' },
    { href: '/workspace/', kind: 'workspace' },
    { href: '/missing?dir=Music', kind: 'notFound' },
  ]

  for (const routeCase of routeCases) {
    test(`classifies and round-trips ${routeCase.href}`, () => {
      const url = new URL(routeCase.href, 'https://media.test')
      const route = parseRoute(url)

      expect(route.kind).toBe(routeCase.kind)
      if (routeCase.directory !== undefined) expect(route.directory).toBe(routeCase.directory)
      expect(hrefFor(route)).toBe(routeCase.href)
    })
  }

  test('parses existing Library viewer, player, and Reader deep links', () => {
    const route = parseRoute({
      pathname: '/',
      search:
        '?dir=Music&viewing=Documents%2Freadme.txt&playing=Music%2Ftrack.mp3&audioOnly=true&reader=Documents%2Freader.epub&readerKind=book',
    })

    expect(route.query).toMatchObject({
      dir: 'Music',
      viewing: 'Documents/readme.txt',
      playing: 'Music/track.mp3',
      audioOnly: true,
      reader: 'Documents/reader.epub',
      readerKind: 'book',
    })
  })

  test('generates canonical surface deep links', () => {
    expect(
      hrefFor(
        { kind: 'library' },
        {
          dir: 'Music & Audio',
          viewing: 'Documents/read me.txt',
          playing: 'Music & Audio/track.mp3',
          audioOnly: true,
          reader: 'Documents/book.epub',
          readerKind: 'book',
        },
      ),
    ).toBe(
      '/?dir=Music+%26+Audio&viewing=Documents%2Fread+me.txt&playing=Music+%26+Audio%2Ftrack.mp3&audioOnly=true&reader=Documents%2Fbook.epub&readerKind=book',
    )
    expect(
      hrefFor({ kind: 'workspace' }, { dir: 'Documents', ws: 'desk 1', preset: 'Reading & notes' }),
    ).toBe('/workspace?dir=Documents&ws=desk+1&preset=Reading+%26+notes')
    expect(hrefFor({ kind: 'canvas' })).toBe('/canvas')
  })

  test('preserves unknown compatibility parameters and hash on parsed routes', () => {
    const href = '/workspace?ws=desk-1&future=value&future=again#window-2'
    const route = parseRoute(new URL(href, 'https://media.test'))

    expect(route.query.ws).toBe('desk-1')
    expect(route.query.extra).toEqual([
      ['future', 'value'],
      ['future', 'again'],
    ])
    expect(hrefFor(route)).toBe(href)
  })

  test('updates typed query state without dropping other deep-link state', () => {
    expect(
      updateRouteSearch(
        {
          pathname: '/',
          search: '?dir=Documents&playing=Music%2Ftrack.mp3&future=kept',
          hash: '#details',
        },
        { viewing: 'Documents/readme.txt', dir: null },
      ),
    ).toBe('/?playing=Music%2Ftrack.mp3&future=kept&viewing=Documents%2Freadme.txt#details')
  })

  test('carries folder context only between surfaces that consume it', () => {
    const library = parseRoute({ pathname: '/', search: '?dir=Music&playing=Music%2Ftrack.mp3' })
    const workspace = parseRoute({
      pathname: '/workspace',
      search: '?dir=Music&ws=desk-1&preset=reading',
      hash: '#window-2',
    })

    expect(hrefForSurface('library', library)).toBe('/?dir=Music&playing=Music%2Ftrack.mp3')
    expect(hrefForSurface('workspace', library)).toBe('/workspace?dir=Music')
    expect(hrefForSurface('canvas', library)).toBe('/canvas')
    expect(hrefForSurface('workspace', workspace)).toBe(
      '/workspace?dir=Music&ws=desk-1&preset=reading#window-2',
    )
  })
})
