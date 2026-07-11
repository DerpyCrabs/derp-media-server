import { afterEach, describe, expect, test } from 'bun:test'
import { Window as HappyWindow } from 'happy-dom'
import {
  downloadInAndroid,
  isAndroidApp,
  openAndroidOffline,
  playInAndroid,
  removeOfflineInAndroid,
} from '@/src/lib/android-bridge'
import { MediaType, type FileItem } from '@/lib/types'

const originalWindow = globalThis.window

function installWindow(messages?: string[]) {
  const window = new HappyWindow({ url: 'https://media.example/' })
  if (messages) {
    ;(
      window as unknown as Window & { DerpAndroid: { postMessage(message: string): void } }
    ).DerpAndroid = { postMessage: (message: string) => messages.push(message) }
  }
  ;(globalThis as unknown as { window: Window }).window = window as unknown as Window
}

const file: FileItem = {
  name: 'movie name.mkv',
  path: 'Movies/movie name.mkv',
  type: MediaType.VIDEO,
  size: 100,
  extension: 'mkv',
  isDirectory: false,
}

afterEach(() => {
  ;(globalThis as unknown as { window: Window }).window = originalWindow
})

describe('Android bridge', () => {
  test('is inert in a regular browser', () => {
    installWindow()
    expect(isAndroidApp()).toBe(false)
    expect(playInAndroid(file)).toBe(false)
  })

  test('sends an absolute admin media URL', () => {
    const messages: string[] = []
    installWindow(messages)
    expect(playInAndroid(file)).toBe(true)
    expect(JSON.parse(messages[0])).toEqual({
      type: 'play',
      url: 'https://media.example/api/media/Movies/movie%20name.mkv',
      title: 'movie name.mkv',
      mediaType: 'video',
    })
  })

  test('keeps share downloads scoped to the token', () => {
    const messages: string[] = []
    installWindow(messages)
    downloadInAndroid(file, { token: 'share-token', sharePath: 'Movies' })
    const payload = JSON.parse(messages[0])
    expect(payload.mediaUrl).toBe(
      'https://media.example/api/share/share-token/media/movie%20name.mkv',
    )
    expect(payload.downloadUrl).toContain('/api/share/share-token/download?path=movie%20name.mkv')
  })

  test('removes offline content without issuing another download', () => {
    const messages: string[] = []
    installWindow(messages)
    expect(removeOfflineInAndroid(file)).toBe(true)
    expect(JSON.parse(messages[0])).toEqual({
      type: 'removeOffline',
      name: 'movie name.mkv',
      displayPath: 'Movies/movie name.mkv',
    })
  })

  test('opens offline files in the existing web interface', () => {
    const messages: string[] = []
    installWindow(messages)
    expect(openAndroidOffline()).toBe(true)
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?offline=1')
    expect(messages).toEqual([])
  })
})
