import { describe, expect, test } from 'bun:test'
import routeCases from '../fixtures/route-cases.json'
import {
  hrefFor,
  hrefForLibraryFile,
  navigate,
  parseRoute,
  type NavigationAdapter,
  type RouteKind,
} from '@/src/lib/routes'

type RouteCase = {
  url: string
  kind: RouteKind
  token?: string
  directory?: string
}

describe('route Module Interface', () => {
  for (const routeCase of routeCases as RouteCase[]) {
    test(`classifies ${routeCase.url}`, () => {
      const url = new URL(routeCase.url, 'https://desk.test')
      const route = parseRoute(url)
      expect(route.kind).toBe(routeCase.kind)
      if (routeCase.directory !== undefined) expect(route.directory).toBe(routeCase.directory)
      expect('token' in route ? route.token : undefined).toBe(routeCase.token)
      expect(hrefFor(route)).toBe(routeCase.url)
    })
  }

  test('generates canonical routes with compatible media state', () => {
    expect(hrefFor({ kind: 'library' })).toBe('/')
    expect(
      hrefFor(
        { kind: 'library' },
        {
          dir: 'Music & Audio',
          playing: 'Music & Audio/track.mp3',
          audioOnly: true,
          offline: true,
        },
      ),
    ).toBe('/?dir=Music+%26+Audio&playing=Music+%26+Audio%2Ftrack.mp3&audioOnly=true&offline=1')
    expect(hrefFor({ kind: 'shareWorkspace', token: 'public token' })).toBe(
      '/share/public%20token/workspace',
    )
  })

  test('decodes share route segments once before canonical re-encoding', () => {
    const route = parseRoute({ pathname: '/share/public%20token' })
    expect(route).toMatchObject({ kind: 'share', token: 'public token' })
    expect(hrefFor(route)).toBe('/share/public%20token')
    if (route.kind !== 'share') throw new Error('Expected share route')
    expect(hrefFor({ kind: 'share', token: route.token })).toBe('/share/public%20token')
  })

  test('generates media-aware Library file routes for Home projections', () => {
    expect(hrefForLibraryFile('Videos/sample.mp4')).toBe('/?playing=Videos%2Fsample.mp4')
    expect(hrefForLibraryFile('Music/track.MP3')).toBe('/?playing=Music%2Ftrack.MP3')
    expect(hrefForLibraryFile('Images/photo.jpg')).toBe('/?viewing=Images%2Fphoto.jpg')
    expect(hrefForLibraryFile('Documents/readme.txt')).toBe('/?viewing=Documents%2Freadme.txt')
  })

  test('preserves legacy path and unknown compatibility parameters', () => {
    const route = parseRoute({
      pathname: '/',
      search: '?path=old%2Ffolder&ws=legacy&p=secret',
      hash: '#section',
    })
    expect(route.query.path).toBe('old/folder')
    expect(route.query.extra).toEqual([
      ['ws', 'legacy'],
      ['p', 'secret'],
    ])
    expect(hrefFor(route)).toBe('/?path=old%2Ffolder&ws=legacy&p=secret#section')
  })

  test('uses generation for push and replace navigation', () => {
    const calls: string[] = []
    const adapter: NavigationAdapter = {
      push: (href) => calls.push(`push:${href}`),
      replace: (href) => calls.push(`replace:${href}`),
    }
    expect(navigate({ kind: 'home' }, { adapter })).toBe('/home')
    expect(navigate({ kind: 'offline' }, { replace: true, adapter })).toBe('/offline')
    expect(calls).toEqual(['push:/home', 'replace:/offline'])
  })

  test('rejects ambiguous share tokens', () => {
    expect(() => hrefFor({ kind: 'share', token: '' })).toThrow()
    expect(() => hrefFor({ kind: 'share', token: 'one/two' })).toThrow()
  })
})
