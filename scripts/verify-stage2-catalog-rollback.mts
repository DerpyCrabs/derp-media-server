import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

type JsonObject = Record<string, unknown>

type RunningServer = {
  baseUrl: string
  child: ChildProcess
  output: () => string
}

type SessionCookie = {
  name: string
  value: string
}

type CreatedShare = {
  token: string
  passcode: string
}

type Gateway = {
  baseUrl: string
  close: () => Promise<void>
  requestCounts: () => { http: number; rpc: number }
  unexpected: () => string[]
}

type ModeSnapshot = {
  label: string
  ownerDocuments: unknown
  ownerDocumentsSsr: unknown
  ownerSharedContent: unknown
  directoryShareInfo: unknown
  directoryShareFiles: unknown
  directoryShareSsrInfo: unknown
  directoryShareSsrFiles: unknown
  singleShareInfo: unknown
  singleShareSsrInfo: unknown
  singleShareDownload: {
    status: number
    contentType: string | null
    contentDisposition: string | null
    body: string
  }
  hermesRoot: unknown
  hermesArchived: unknown
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.join(
  root,
  process.platform === 'win32'
    ? 'target/release/derp-media-server.exe'
    : 'target/release/derp-media-server',
)
const password = 'stage2-rollback-password'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertDeep(actual: unknown, expected: unknown, message: string): void {
  if (isDeepStrictEqual(actual, expected)) return
  throw new Error(
    `${message}\nactual=${JSON.stringify(actual, null, 2)}\nexpected=${JSON.stringify(expected, null, 2)}`,
  )
}

function object(value: unknown, message: string): JsonObject {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), message)
  return value as JsonObject
}

function array(value: unknown, message: string): unknown[] {
  assert(Array.isArray(value), message)
  return value
}

function listingFiles(value: unknown, message: string): JsonObject[] {
  return array(object(value, message).files, `${message} omitted files`).map((item, index) =>
    object(item, `${message} file ${index} is invalid`),
  )
}

function namedFile(value: unknown, name: string, message: string): JsonObject {
  const item = listingFiles(value, message).find((candidate) => candidate.name === name)
  assert(item, `${message} omitted ${name}`)
  return item
}

function stripResources(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripResources)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([key]) => key !== 'resource')
      .map(([key, child]) => [key, stripResources(child)]),
  )
}

function countResources(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, child) => total + countResources(child), 0)
  if (value === null || typeof value !== 'object') return 0
  return Object.entries(value as JsonObject).reduce(
    (total, [key, child]) => total + (key === 'resource' ? 1 : countResources(child)),
    0,
  )
}

function resource(value: JsonObject, message: string): JsonObject {
  return object(value.resource, message)
}

function resourceRef(value: JsonObject, message: string): JsonObject {
  return object(resource(value, message).ref, `${message} omitted ref`)
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (!address || typeof address === 'string') reject(new Error('No free TCP port'))
        else resolve(address.port)
      })
    })
  })
}

async function startHermesGateway(): Promise<Gateway> {
  let httpRequests = 0
  let rpcRequests = 0
  const unexpectedRequests: string[] = []
  const httpServer: HttpServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/sessions') {
      httpRequests += 1
      const archived = url.searchParams.get('archived') === 'only'
      const sessions = archived
        ? [
            {
              id: 'archived-session',
              title: 'Archived Rollback Session',
              last_active: 1,
              archived: true,
            },
          ]
        : [{ id: 'active-session', title: 'Active Rollback Session', last_active: 2 }]
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ sessions, total: sessions.length }))
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      httpRequests += 1
      const id = url.pathname.slice('/api/sessions/'.length)
      const archived = id === 'archived-session'
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id,
          title: archived ? 'Archived Rollback Session' : 'Active Rollback Session',
          last_active: archived ? 1 : 2,
          archived,
        }),
      )
      return
    }
    unexpectedRequests.push(`${request.method ?? 'UNKNOWN'} ${url.pathname}`)
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Unexpected Hermes rollback request' }))
  })
  const sockets = new Set<import('ws').WebSocket>()
  const webSockets = new WebSocketServer({ server: httpServer, path: '/api/ws' })
  webSockets.on('connection', (socket, request) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.searchParams.get('token') !== 'stage2-hermes-token') {
      unexpectedRequests.push('Hermes WebSocket omitted configured token')
    }
    socket.on('message', (raw) => {
      const request = JSON.parse(raw.toString()) as JsonObject
      rpcRequests += 1
      const id = request.id
      const method = request.method
      if (method === 'projects.list') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, result: { projects: [] } }))
      } else {
        unexpectedRequests.push(`RPC ${String(method)}`)
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unexpected rollback RPC ${String(method)}` },
          }),
        )
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address()
  assert(address && typeof address !== 'string', 'Hermes gateway omitted TCP address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCounts: () => ({ http: httpRequests, rpc: rpcRequests }),
    unexpected: () => [...unexpectedRequests],
    close: async () => {
      for (const socket of sockets) socket.terminate()
      await new Promise<void>((resolve) => webSockets.close(() => resolve()))
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

async function waitForServer(server: RunningServer): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Production server exited early (${server.child.exitCode}):\n${server.output()}`,
      )
    }
    try {
      const response = await fetch(`${server.baseUrl}/login`, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for production server:\n${server.output()}`)
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill()
  })
}

async function startServer(
  tempRoot: string,
  mediaDir: string,
  gateway: Gateway,
  label: string,
  catalogReads: string | undefined,
): Promise<RunningServer> {
  const instanceRoot = path.join(tempRoot, label)
  const dataPath = path.join(instanceRoot, 'data')
  const configPath = path.join(instanceRoot, 'config.json')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  fs.mkdirSync(dataPath, { recursive: true })
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      mediaDir,
      mediaSourceId: 'stage2-rollback-media',
      dataPath,
      shareLinkDomain: baseUrl,
      port,
      auth: { enabled: true, password, secureCookies: false },
      fileSearch: { enabled: false },
      imageOptimization: { enabled: false },
      hermes: {
        gatewayUrl: gateway.baseUrl,
        token: 'stage2-hermes-token',
        profile: 'rollback',
        autoStart: false,
      },
    }),
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    CONFIG_PATH: configPath,
    NO_PROXY: 'localhost,127.0.0.1',
  }
  if (catalogReads === undefined) delete env.CATALOG_READS
  else env.CATALOG_READS = catalogReads

  let output = ''
  const child = spawn(executable, ['--production'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })
  const server = { baseUrl, child, output: () => output }
  try {
    await waitForServer(server)
    return server
  } catch (error) {
    await stopServer(child)
    throw error
  }
}

async function login(baseUrl: string): Promise<SessionCookie> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${await response.text()}`)
  }
  const pair = response.headers.get('set-cookie')?.split(';', 1)[0]
  const separator = pair?.indexOf('=') ?? -1
  assert(pair && separator > 0, 'Login did not return session cookie')
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} failed: ${response.status} ${await response.text()}`,
    )
  }
  return await response.json()
}

function dehydratedQuery(html: string, key: unknown[]): unknown {
  const prefix = '<script>window.__DEHYDRATED_STATE__='
  const start = html.indexOf(prefix)
  const end = html.indexOf('</script>', start)
  assert(start >= 0 && end > start, 'SSR response omitted dehydrated state')
  const state = JSON.parse(html.slice(start + prefix.length, end)) as {
    queries?: Array<{ queryKey?: unknown[]; state?: { data?: unknown } }>
  }
  const query = state.queries?.find(
    (candidate) => JSON.stringify(candidate.queryKey) === JSON.stringify(key),
  )
  assert(query, `SSR response omitted query ${JSON.stringify(key)}`)
  return query.state?.data
}

async function ssrQuery(url: string, key: unknown[], cookie?: SessionCookie): Promise<unknown> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: cookie ? { Cookie: `${cookie.name}=${cookie.value}` } : undefined,
  })
  assert(response.status === 200, `SSR ${url} returned ${response.status}`)
  return dehydratedQuery(await response.text(), key)
}

async function createShare(
  server: RunningServer,
  cookie: SessionCookie,
  path: string,
  isDirectory: boolean,
): Promise<CreatedShare> {
  const result = object(
    await jsonRequest(`${server.baseUrl}/api/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${cookie.name}=${cookie.value}`,
      },
      body: JSON.stringify({ path, isDirectory }),
    }),
    `Create share ${path} returned invalid JSON`,
  )
  const share = object(result.share, `Create share ${path} omitted share`)
  const token = share.token
  const passcode = share.passcode
  assert(typeof token === 'string' && token.length > 0, `Create share ${path} omitted token`)
  assert(
    typeof passcode === 'string' && passcode.length > 0,
    `Authenticated create share ${path} omitted passcode`,
  )
  return { token, passcode }
}

async function verifyShare(server: RunningServer, share: CreatedShare): Promise<SessionCookie> {
  const response = await fetch(`${server.baseUrl}/api/share/${share.token}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: share.passcode }),
  })
  if (!response.ok) {
    throw new Error(
      `Verify share ${share.token} failed: ${response.status} ${await response.text()}`,
    )
  }
  const pair = response.headers.get('set-cookie')?.split(';', 1)[0]
  const separator = pair?.indexOf('=') ?? -1
  assert(pair && separator > 0, `Verify share ${share.token} omitted session cookie`)
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}

async function captureMode(
  tempRoot: string,
  mediaDir: string,
  gateway: Gateway,
  mode: { label: string; env: string | undefined; catalogOn: boolean },
): Promise<ModeSnapshot> {
  console.log(`${mode.label}: starting production server`)
  const server = await startServer(tempRoot, mediaDir, gateway, mode.label, mode.env)
  try {
    const cookie = await login(server.baseUrl)
    const ownerHeaders = { Cookie: `${cookie.name}=${cookie.value}` }
    const ownerDocuments = await jsonRequest(`${server.baseUrl}/api/files?dir=Documents`, {
      headers: ownerHeaders,
    })
    const ownerDocumentsSsr = await ssrQuery(
      `${server.baseUrl}/?dir=Documents`,
      ['files', 'Documents'],
      cookie,
    )
    assertDeep(ownerDocumentsSsr, ownerDocuments, `${mode.label}: owner API and SSR diverged`)
    const ownerSharedContent = await jsonRequest(`${server.baseUrl}/api/files?dir=SharedContent`, {
      headers: ownerHeaders,
    })

    const directoryShare = await createShare(server, cookie, 'SharedContent', true)
    const directoryToken = directoryShare.token
    const directoryCookie = await verifyShare(server, directoryShare)
    const directoryHeaders = { Cookie: `${directoryCookie.name}=${directoryCookie.value}` }
    const directoryShareInfo = await jsonRequest(
      `${server.baseUrl}/api/share/${directoryToken}/info`,
      { headers: directoryHeaders },
    )
    const directoryShareFiles = await jsonRequest(
      `${server.baseUrl}/api/share/${directoryToken}/files?dir=`,
      { headers: directoryHeaders },
    )
    const directoryShareSsrInfo = await ssrQuery(
      `${server.baseUrl}/share/${directoryToken}`,
      ['share-info', directoryToken],
      directoryCookie,
    )
    const directoryShareSsrFiles = await ssrQuery(
      `${server.baseUrl}/share/${directoryToken}`,
      ['share-files', directoryToken, ''],
      directoryCookie,
    )
    assertDeep(
      directoryShareSsrInfo,
      directoryShareInfo,
      `${mode.label}: directory share API and SSR info diverged`,
    )
    assertDeep(
      directoryShareSsrFiles,
      directoryShareFiles,
      `${mode.label}: directory share API and SSR files diverged`,
    )

    const singleShare = await createShare(server, cookie, 'Documents/readme.txt', false)
    const singleToken = singleShare.token
    const singleCookie = await verifyShare(server, singleShare)
    const singleHeaders = { Cookie: `${singleCookie.name}=${singleCookie.value}` }
    const singleShareInfo = await jsonRequest(`${server.baseUrl}/api/share/${singleToken}/info`, {
      headers: singleHeaders,
    })
    const singleShareSsrInfo = await ssrQuery(
      `${server.baseUrl}/share/${singleToken}`,
      ['share-info', singleToken],
      singleCookie,
    )
    assertDeep(
      singleShareSsrInfo,
      singleShareInfo,
      `${mode.label}: single-file share API and SSR info diverged`,
    )
    const download = await fetch(`${server.baseUrl}/api/share/${singleToken}/download`, {
      headers: singleHeaders,
    })
    const singleShareDownload = {
      status: download.status,
      contentType: download.headers.get('content-type'),
      contentDisposition: download.headers.get('content-disposition'),
      body: await download.text(),
    }
    assert(singleShareDownload.status === 200, `${mode.label}: single-file download failed`)

    const hermesRoot = await jsonRequest(
      `${server.baseUrl}/api/files?surface=workspace&dir=${encodeURIComponent('Hermes Sessions')}`,
      { headers: ownerHeaders },
    )
    const hermesArchived = await jsonRequest(
      `${server.baseUrl}/api/files?surface=workspace&dir=${encodeURIComponent('Hermes Sessions/archived')}`,
      { headers: ownerHeaders },
    )

    const resources = [
      ownerDocuments,
      ownerDocumentsSsr,
      ownerSharedContent,
      directoryShareInfo,
      directoryShareFiles,
      directoryShareSsrInfo,
      directoryShareSsrFiles,
      singleShareInfo,
      singleShareSsrInfo,
      hermesRoot,
      hermesArchived,
    ]
    const resourceCount = resources.reduce<number>(
      (total, value) => total + countResources(value),
      0,
    )
    if (mode.catalogOn) {
      assert(
        resourceCount >= 10,
        `${mode.label}: catalog reads returned only ${resourceCount} Resources`,
      )
      const ownerReadme = namedFile(ownerDocuments, 'readme.txt', `${mode.label} owner Documents`)
      const ownerReadmeSsr = namedFile(
        ownerDocumentsSsr,
        'readme.txt',
        `${mode.label} owner Documents SSR`,
      )
      assertDeep(
        resource(ownerReadmeSsr, `${mode.label}: SSR readme omitted Resource`),
        resource(ownerReadme, `${mode.label}: owner readme omitted Resource`),
        `${mode.label}: owner Resource changed between API and SSR`,
      )
      assertDeep(
        resourceRef(
          object(singleShareInfo, `${mode.label}: invalid single share info`),
          'single share',
        ),
        resourceRef(ownerReadme, 'owner readme'),
        `${mode.label}: single share changed Resource identity`,
      )
      const ownerPublic = namedFile(
        ownerSharedContent,
        'public-doc.txt',
        `${mode.label} owner SharedContent`,
      )
      const grantPublic = namedFile(
        directoryShareFiles,
        'public-doc.txt',
        `${mode.label} directory share`,
      )
      assertDeep(
        resourceRef(grantPublic, 'directory share public-doc'),
        resourceRef(ownerPublic, 'owner public-doc'),
        `${mode.label}: directory Grant changed Resource identity`,
      )

      const ownerRef = resourceRef(ownerReadme, 'owner readme')
      const ownerInspect = object(
        await jsonRequest(
          `${server.baseUrl}/api/resources/inspect?libraryId=${encodeURIComponent(String(ownerRef.libraryId))}` +
            `&resourceId=${encodeURIComponent(String(ownerRef.resourceId))}`,
          { headers: ownerHeaders },
        ),
        `${mode.label}: owner inspect returned invalid JSON`,
      )
      assertDeep(
        object(object(ownerInspect.summary, 'owner inspect omitted summary').ref, 'inspect ref'),
        ownerRef,
        `${mode.label}: owner inspect changed Resource identity`,
      )
      const ownerResolve = object(
        await jsonRequest(
          `${server.baseUrl}/api/resources/resolve?legacyLocator=${encodeURIComponent('Documents/readme.txt')}` +
            '&surface=workspace',
          { headers: ownerHeaders },
        ),
        `${mode.label}: owner resolve returned invalid JSON`,
      )
      assertDeep(
        object(object(ownerResolve.summary, 'owner resolve omitted summary').ref, 'resolve ref'),
        ownerRef,
        `${mode.label}: owner legacy resolution changed Resource identity`,
      )
      const grantRef = resourceRef(grantPublic, 'directory share public-doc')
      const grantInspect = object(
        await jsonRequest(
          `${server.baseUrl}/api/share/${directoryToken}/resources/inspect?` +
            `libraryId=${encodeURIComponent(String(grantRef.libraryId))}` +
            `&resourceId=${encodeURIComponent(String(grantRef.resourceId))}`,
          { headers: directoryHeaders },
        ),
        `${mode.label}: Grant inspect returned invalid JSON`,
      )
      assertDeep(
        object(object(grantInspect.summary, 'Grant inspect omitted summary').ref, 'inspect ref'),
        grantRef,
        `${mode.label}: Grant inspect changed Resource identity`,
      )
      const grantResolve = object(
        await jsonRequest(
          `${server.baseUrl}/api/share/${directoryToken}/resources/resolve?` +
            `legacyLocator=${encodeURIComponent('SharedContent/public-doc.txt')}`,
          { headers: directoryHeaders },
        ),
        `${mode.label}: Grant resolve returned invalid JSON`,
      )
      assertDeep(
        object(object(grantResolve.summary, 'Grant resolve omitted summary').ref, 'resolve ref'),
        grantRef,
        `${mode.label}: Grant legacy resolution changed Resource identity`,
      )
    } else {
      assert(resourceCount === 0, `${mode.label}: rollback leaked ${resourceCount} Resource fields`)
      const expectedUnsupported = {
        code: 'unsupported',
        message: 'Resource inspection is disabled by catalog_reads rollback',
      }
      const ownerInspect = await fetch(
        `${server.baseUrl}/api/resources/inspect?libraryId=rollback&resourceId=rollback`,
        { headers: ownerHeaders },
      )
      assert(ownerInspect.status === 400, `${mode.label}: owner inspect was not disabled`)
      assertDeep(
        await ownerInspect.json(),
        expectedUnsupported,
        `${mode.label}: owner inspect rollback error was not typed`,
      )
      const grantInspect = await fetch(
        `${server.baseUrl}/api/share/${directoryToken}/resources/inspect?` +
          'libraryId=rollback&resourceId=rollback',
        { headers: directoryHeaders },
      )
      assert(grantInspect.status === 400, `${mode.label}: Grant inspect was not disabled`)
      assertDeep(
        await grantInspect.json(),
        expectedUnsupported,
        `${mode.label}: Grant inspect rollback error was not typed`,
      )
      const expectedResolveUnsupported = {
        code: 'unsupported',
        message: 'Resource legacy resolution is disabled by catalog_reads rollback',
      }
      const ownerResolve = await fetch(
        `${server.baseUrl}/api/resources/resolve?legacyLocator=${encodeURIComponent('Documents/readme.txt')}` +
          '&surface=workspace',
        { headers: ownerHeaders },
      )
      assert(ownerResolve.status === 400, `${mode.label}: owner resolve was not disabled`)
      assertDeep(
        await ownerResolve.json(),
        expectedResolveUnsupported,
        `${mode.label}: owner resolve rollback error was not typed`,
      )
      const grantResolve = await fetch(
        `${server.baseUrl}/api/share/${directoryToken}/resources/resolve?` +
          `legacyLocator=${encodeURIComponent('SharedContent/public-doc.txt')}`,
        { headers: directoryHeaders },
      )
      assert(grantResolve.status === 400, `${mode.label}: Grant resolve was not disabled`)
      assertDeep(
        await grantResolve.json(),
        expectedResolveUnsupported,
        `${mode.label}: Grant resolve rollback error was not typed`,
      )
    }

    console.log(
      `${mode.label}: owner API/SSR, inspect/resolve, directory Grant API/SSR/inspect/resolve, single-file read, Hermes root/archive passed (${resourceCount} Resource fields)`,
    )
    return {
      label: mode.label,
      ownerDocuments,
      ownerDocumentsSsr,
      ownerSharedContent,
      directoryShareInfo,
      directoryShareFiles,
      directoryShareSsrInfo,
      directoryShareSsrFiles,
      singleShareInfo,
      singleShareSsrInfo,
      singleShareDownload,
      hermesRoot,
      hermesArchived,
    }
  } finally {
    await stopServer(server.child)
  }
}

function compareLegacy(on: ModeSnapshot, off: ModeSnapshot): void {
  for (const key of [
    'ownerDocuments',
    'ownerDocumentsSsr',
    'ownerSharedContent',
    'directoryShareInfo',
    'directoryShareFiles',
    'directoryShareSsrInfo',
    'directoryShareSsrFiles',
    'singleShareInfo',
    'singleShareSsrInfo',
    'hermesRoot',
    'hermesArchived',
  ] as const) {
    assertDeep(
      stripResources(on[key]),
      stripResources(off[key]),
      `Catalog cutover changed legacy-visible ${key}`,
    )
  }
  assertDeep(
    on.singleShareDownload,
    off.singleShareDownload,
    'Catalog cutover changed single-file share download',
  )
}

assert(fs.existsSync(executable), `Release server missing: ${executable}. Run bun run build first.`)
assert(
  fs.existsSync(path.join(root, 'dist/client/index.html')),
  'Production client missing. Run bun run build first.',
)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-stage2-catalog-rollback-'))
const mediaDir = path.join(tempRoot, 'media')
fs.mkdirSync(path.join(mediaDir, 'Documents'), { recursive: true })
fs.mkdirSync(path.join(mediaDir, 'SharedContent', 'Nested'), { recursive: true })
fs.writeFileSync(path.join(mediaDir, 'Documents', 'readme.txt'), 'stage 2 single-file rollback\n')
fs.writeFileSync(path.join(mediaDir, 'Documents', 'data.json'), '{"rollback":true}\n')
fs.writeFileSync(path.join(mediaDir, 'SharedContent', 'public-doc.txt'), 'stage 2 Grant rollback\n')
fs.writeFileSync(path.join(mediaDir, 'SharedContent', 'Nested', 'note.md'), '# Rollback\n')
const fixedMtime = new Date('2026-01-02T03:04:05.000Z')
for (const entry of [
  path.join(mediaDir, 'Documents', 'readme.txt'),
  path.join(mediaDir, 'Documents', 'data.json'),
  path.join(mediaDir, 'SharedContent', 'public-doc.txt'),
  path.join(mediaDir, 'SharedContent', 'Nested', 'note.md'),
  path.join(mediaDir, 'SharedContent', 'Nested'),
  path.join(mediaDir, 'SharedContent'),
  path.join(mediaDir, 'Documents'),
  mediaDir,
]) {
  fs.utimesSync(entry, fixedMtime, fixedMtime)
}

let gateway: Gateway | undefined
try {
  gateway = await startHermesGateway()
  const catalogOn = await captureMode(tempRoot, mediaDir, gateway, {
    label: 'CATALOG_READS=default',
    env: undefined,
    catalogOn: true,
  })
  const catalogOff = await captureMode(tempRoot, mediaDir, gateway, {
    label: 'CATALOG_READS=0',
    env: '0',
    catalogOn: false,
  })
  compareLegacy(catalogOn, catalogOff)
  const counts = gateway.requestCounts()
  assert(counts.rpc >= 2, `Hermes gateway saw only ${counts.rpc} JSON-RPC requests`)
  assert(counts.http >= 4, `Hermes gateway saw only ${counts.http} HTTP requests`)
  assertDeep(gateway.unexpected(), [], 'Hermes gateway received unexpected requests')
  console.log(
    `Hermes transport exercised: ${counts.rpc} WebSocket RPC requests, ${counts.http} HTTP requests`,
  )
  console.log('Stage 2 production catalog rollback/cutover verification passed')
} finally {
  if (gateway) await gateway.close()
  const resolvedTemp = path.resolve(tempRoot)
  const resolvedOsTemp = path.resolve(os.tmpdir())
  assert(
    path.dirname(resolvedTemp) === resolvedOsTemp &&
      path.basename(resolvedTemp).startsWith('derp-stage2-catalog-rollback-'),
    `Refusing to clean unexpected temporary path: ${resolvedTemp}`,
  )
  fs.rmSync(resolvedTemp, { recursive: true, force: true })
}
