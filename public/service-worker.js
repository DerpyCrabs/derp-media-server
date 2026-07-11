const SHELL_CACHE = 'derp-shell-v1'
const PRECACHE = /* __PRECACHE__ */ []
const DB_NAME = 'derp-offline-v1'
const STORE = 'entries'

async function shellMatch(request) {
  return (await caches.open(SHELL_CACHE)).match(request)
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'path' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function entries() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function entry(path) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(path)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function storedBody(saved) {
  if (saved?.blob) return saved.blob
  if (!saved?.fileName || !navigator.storage?.getDirectory) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await (await root.getFileHandle(saved.fileName)).getFile()
  } catch {
    return null
  }
}

function offlineListing(all, dir) {
  const normalized = dir.replace(/^\/+|\/+$/g, '')
  const children = new Map()
  for (const item of all) {
    const path = item.path.replace(/^\/+|\/+$/g, '')
    let relative
    if (!normalized) relative = path
    else if (path === normalized) continue
    else if (path.startsWith(`${normalized}/`)) relative = path.slice(normalized.length + 1)
    else continue
    if (!relative) continue
    const name = relative.split('/')[0]
    const childPath = normalized ? `${normalized}/${name}` : name
    const exact = all.find((candidate) => candidate.path === childPath)
    const isDirectory = relative.includes('/') || exact?.isDirectory === true
    const type = isDirectory ? 'folder' : exact?.type || item.type || 'other'
    children.set(name, {
      name,
      path: childPath,
      type,
      size: isDirectory ? 0 : exact?.size || item.size || 0,
      extension: isDirectory ? '' : name.includes('.') ? name.split('.').pop() : '',
      isDirectory,
      thumbnailGenerated: type === 'image',
    })
  }
  return [...children.values()]
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('derp-shell-') && key !== SHELL_CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  if (
    event.request.mode === 'navigate' &&
    (url.pathname === '/workspace' || /^\/share\/[^/]+\/workspace\/?$/.test(url.pathname))
  )
    return

  if (url.pathname === '/__offline/files') {
    if (event.request.headers.get('x-derp-native-offline') === '1') {
      event.respondWith(fetch(event.request))
      return
    }
    event.respondWith(
      entries().then(
        (all) =>
          new Response(
            JSON.stringify({ files: offlineListing(all, url.searchParams.get('dir') || '') }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    return
  }

  if (
    url.pathname.startsWith('/api/media/') ||
    /^\/api\/share\/[^/]+\/media\//.test(url.pathname)
  ) {
    const adminPath = url.pathname.startsWith('/api/media/')
      ? decodeURIComponent(url.pathname.slice('/api/media/'.length)).replace(/^\/+|\/+$/g, '')
      : null
    event.respondWith(
      (adminPath
        ? entry(adminPath)
        : entries().then((all) => all.find((item) => item.mediaUrl === url.pathname))
      ).then(async (saved) => {
        const bodyFile = await storedBody(saved)
        if (!bodyFile) return fetch(event.request)
        const range = event.request.headers.get('range')
        if (range) {
          const match = range.match(/^bytes=(\d+)-(\d*)$/)
          if (match) {
            const start = Number(match[1])
            const end = match[2] ? Math.min(Number(match[2]), bodyFile.size - 1) : bodyFile.size - 1
            const body = bodyFile.slice(start, end + 1, bodyFile.type)
            return new Response(body, {
              status: 206,
              headers: {
                'Content-Type': bodyFile.type || 'application/octet-stream',
                'Content-Length': String(body.size),
                'Content-Range': `bytes ${start}-${end}/${bodyFile.size}`,
                'Accept-Ranges': 'bytes',
              },
            })
          }
        }
        return new Response(bodyFile, {
          headers: {
            'Content-Type': bodyFile.type || 'application/octet-stream',
            'Content-Length': String(bodyFile.size),
            'Accept-Ranges': 'bytes',
          },
        })
      }),
    )
    return
  }

  if (url.pathname.startsWith('/api/thumbnail/')) {
    const path = decodeURIComponent(url.pathname.slice('/api/thumbnail/'.length)).replace(
      /^\/+|\/+$/g,
      '',
    )
    event.respondWith(
      entry(path).then(async (saved) => {
        const bodyFile = await storedBody(saved)
        if (!bodyFile || saved.type !== 'image') return fetch(event.request)
        return new Response(bodyFile, { headers: { 'Content-Type': bodyFile.type || 'image/*' } })
      }),
    )
    return
  }

  if (/^\/api\/share\/[^/]+\/thumbnail\//.test(url.pathname)) {
    event.respondWith(
      entries().then(async (all) => {
        const saved = all.find((item) => item.thumbnailUrl === url.pathname)
        const bodyFile = await storedBody(saved)
        if (!bodyFile || saved.type !== 'image') return fetch(event.request)
        return new Response(bodyFile, { headers: { 'Content-Type': bodyFile.type || 'image/*' } })
      }),
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response.ok) throw new Error(`Navigation failed: ${response.status}`)
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => (await shellMatch('/index.html')) || Response.error()),
    )
    return
  }

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(shellMatch(event.request).then((cached) => cached || fetch(event.request)))
    return
  }

  if (!url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response.ok) throw new Error(`Request failed: ${response.status}`)
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => shellMatch(event.request).then((cached) => cached || Response.error())),
    )
  }
})
