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
  }> = [
    { href: '/', kind: 'library' },
    {
      href: '/?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic',
      kind: 'library',
    },
    {
      href: '/workspace?provider=filesystem&resource=v1%3Aconfigured-default%3ADocuments&ws=desk-1&preset=reading',
      kind: 'workspace',
    },
    { href: '/canvas', kind: 'canvas' },
    { href: '/workspace/', kind: 'workspace' },
    {
      href: '/missing?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic',
      kind: 'notFound',
    },
  ]

  for (const routeCase of routeCases) {
    test(`classifies and round-trips ${routeCase.href}`, () => {
      const url = new URL(routeCase.href, 'https://media.test')
      const route = parseRoute(url)

      expect(route.kind).toBe(routeCase.kind)
      expect(hrefFor(route)).toBe(routeCase.href)
    })
  }

  test('parses canonical Library viewer, player, and Reader deep links', () => {
    const route = parseRoute({
      pathname: '/',
      search:
        '?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic&viewing=Documents%2Freadme.txt&playing=Music%2Ftrack.mp3&audioOnly=true&reader=Documents%2Freader.epub&readerKind=book',
    })

    expect(route.query).toMatchObject({
      provider: 'filesystem',
      resource: 'v1:configured-default:Music',
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
          provider: 'filesystem',
          resource: 'v1:configured-default:Music & Audio',
          viewing: 'Documents/read me.txt',
          playing: 'Music & Audio/track.mp3',
          audioOnly: true,
          reader: 'Documents/book.epub',
          readerKind: 'book',
        },
      ),
    ).toBe(
      '/?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic+%26+Audio&viewing=Documents%2Fread+me.txt&playing=Music+%26+Audio%2Ftrack.mp3&audioOnly=true&reader=Documents%2Fbook.epub&readerKind=book',
    )
    expect(
      hrefFor(
        { kind: 'workspace' },
        {
          provider: 'filesystem',
          resource: 'v1:configured-default:Documents',
          ws: 'desk 1',
          preset: 'Reading & notes',
        },
      ),
    ).toBe(
      '/workspace?provider=filesystem&resource=v1%3Aconfigured-default%3ADocuments&ws=desk+1&preset=Reading+%26+notes',
    )
    expect(hrefFor({ kind: 'canvas' })).toBe('/canvas')
    expect(
      hrefFor(
        { kind: 'library' },
        { provider: 'fixture', resource: 'opaque/value?without-path-semantics' },
      ),
    ).toBe('/?provider=fixture&resource=opaque%2Fvalue%3Fwithout-path-semantics')
  })

  test('preserves unknown query parameters and hash on parsed routes', () => {
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
          search:
            '?provider=filesystem&resource=v1%3Aconfigured-default%3ADocuments&playing=Music%2Ftrack.mp3&future=kept',
          hash: '#details',
        },
        { viewing: 'Documents/readme.txt', playing: null },
      ),
    ).toBe(
      '/?provider=filesystem&resource=v1%3Aconfigured-default%3ADocuments&future=kept&viewing=Documents%2Freadme.txt#details',
    )
  })

  test('carries resource context only between surfaces that consume it', () => {
    const library = parseRoute({
      pathname: '/',
      search:
        '?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic&playing=Music%2Ftrack.mp3',
    })
    const workspace = parseRoute({
      pathname: '/workspace',
      search: '?provider=fixture&resource=opaque%2Fid&ws=desk-1&preset=reading',
      hash: '#window-2',
    })

    expect(hrefForSurface('library', library)).toBe(
      '/?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic&playing=Music%2Ftrack.mp3',
    )
    expect(hrefForSurface('workspace', library)).toBe(
      '/workspace?provider=filesystem&resource=v1%3Aconfigured-default%3AMusic',
    )
    expect(hrefForSurface('canvas', library)).toBe('/canvas')
    expect(hrefForSurface('workspace', workspace)).toBe(
      '/workspace?provider=fixture&resource=opaque%2Fid&ws=desk-1&preset=reading#window-2',
    )
    expect(hrefForSurface('library', workspace)).toBe('/?provider=fixture&resource=opaque%2Fid')
  })
})
