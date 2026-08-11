import { chromium, expect, type Browser, type BrowserContext } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type RunningServer = {
  baseUrl: string
  child: ChildProcess
  output: () => string
}

type SessionCookie = {
  name: string
  value: string
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.join(
  root,
  process.platform === 'win32'
    ? 'target/release/derp-media-server.exe'
    : 'target/release/derp-media-server',
)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
  label: string,
  newShell: string | undefined,
): Promise<RunningServer> {
  const instanceRoot = path.join(tempRoot, label)
  const mediaDir = path.join(instanceRoot, 'media')
  const dataPath = path.join(instanceRoot, 'data')
  const configPath = path.join(instanceRoot, 'config.json')
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  fs.mkdirSync(mediaDir, { recursive: true })
  fs.mkdirSync(dataPath, { recursive: true })
  fs.writeFileSync(path.join(mediaDir, 'rollback-check.txt'), 'production rollback check')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      mediaDir,
      dataPath,
      shareLinkDomain: baseUrl,
      port,
      auth: { enabled: true, password: 'stage1-rollback-password', secureCookies: false },
    }),
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    CONFIG_PATH: configPath,
    NO_PROXY: 'localhost,127.0.0.1',
  }
  if (newShell === undefined) delete env.NEW_SHELL
  else env.NEW_SHELL = newShell

  let output = ''
  const child = spawn(executable, ['--production'], { cwd: root, env })
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
    body: JSON.stringify({ password: 'stage1-rollback-password' }),
  })
  assert(response.ok, `Login failed: ${response.status} ${await response.text()}`)
  const pair = response.headers.get('set-cookie')?.split(';', 1)[0]
  const separator = pair?.indexOf('=') ?? -1
  assert(pair && separator > 0, 'Login did not return session cookie')
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}

async function inspectUnauthenticatedBoundary(server: RunningServer): Promise<void> {
  const documentResponse = await fetch(`${server.baseUrl}/home`, { redirect: 'manual' })
  assert(
    documentResponse.status === 302,
    `Unauthenticated /home returned ${documentResponse.status}`,
  )
  assert(
    documentResponse.headers.get('location') === '/login',
    `Unauthenticated /home redirected to ${documentResponse.headers.get('location')}`,
  )

  const apiResponse = await fetch(`${server.baseUrl}/api/auth/config`)
  assert(apiResponse.status === 401, `Unauthenticated auth config returned ${apiResponse.status}`)
}

function shellValueFromHtml(html: string): boolean {
  const prefix = '<script>window.__DEHYDRATED_STATE__='
  const start = html.indexOf(prefix)
  const end = html.indexOf('</script>', start)
  assert(start >= 0 && end > start, 'SSR response omitted dehydrated state')
  const state = JSON.parse(html.slice(start + prefix.length, end)) as {
    queries?: { queryKey?: unknown[]; state?: { data?: { newShell?: unknown } } }[]
  }
  const query = state.queries?.find(
    (candidate) => candidate.queryKey?.length === 1 && candidate.queryKey[0] === 'auth-config',
  )
  assert(query, 'SSR response omitted auth-config query')
  assert(typeof query.state?.data?.newShell === 'boolean', 'SSR newShell value is not boolean')
  return query.state.data.newShell
}

async function inspectServerContract(
  server: RunningServer,
  cookie: SessionCookie,
  expected: boolean,
): Promise<void> {
  const cookieHeader = `${cookie.name}=${cookie.value}`
  const apiResponse = await fetch(`${server.baseUrl}/api/auth/config`, {
    headers: { Cookie: cookieHeader },
  })
  assert(apiResponse.ok, `Auth config failed: ${apiResponse.status}`)
  const config = (await apiResponse.json()) as { newShell?: unknown }
  assert(
    config.newShell === expected,
    `API newShell=${String(config.newShell)}, expected ${expected}`,
  )

  const documentResponse = await fetch(`${server.baseUrl}/home`, {
    headers: { Cookie: cookieHeader },
    redirect: 'manual',
  })
  assert(
    documentResponse.status === 200,
    `Authenticated SSR /home returned ${documentResponse.status}`,
  )
  const ssrValue = shellValueFromHtml(await documentResponse.text())
  assert(ssrValue === expected, `SSR newShell=${ssrValue}, expected ${expected}`)
}

async function authenticatedContext(
  browser: Browser,
  server: RunningServer,
  cookie: SessionCookie,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: server.baseUrl })
  await context.addCookies([{ ...cookie, url: server.baseUrl }])
  return context
}

async function inspectPresenters(
  browser: Browser,
  server: RunningServer,
  cookie: SessionCookie,
  modern: boolean,
): Promise<void> {
  const context = await authenticatedContext(browser, server, cookie)
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  try {
    const libraryResponse = await page.goto('/')
    assert(libraryResponse?.status() === 200, `/ navigation returned ${libraryResponse?.status()}`)
    await expect(page.locator('[data-owner-shell]')).toHaveCount(modern ? 1 : 0)
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await expect(page.getByTestId('home-page')).toHaveCount(0)

    const homeResponse = await page.goto('/home')
    assert(homeResponse?.status() === 200, `/home navigation returned ${homeResponse?.status()}`)
    await expect(page.locator('[data-owner-shell]')).toHaveCount(modern ? 1 : 0)
    await expect(page.getByTestId('home-page')).toHaveCount(modern ? 1 : 0)
    if (modern) await expect(page.getByTestId('file-browser')).toHaveCount(0)
    else await expect(page.getByTestId('file-browser')).toBeVisible()

    const workspaceResponse = await page.goto('/workspace')
    assert(
      workspaceResponse?.status() === 200,
      `/workspace navigation returned ${workspaceResponse?.status()}`,
    )
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(page.locator('[data-owner-shell]')).toHaveCount(modern ? 1 : 0)
    await expect(page.getByTestId('home-page')).toHaveCount(0)
    await expect(page.getByTestId('file-browser')).toHaveCount(0)
  } finally {
    await context.close()
  }
}

async function verifyMode(
  browser: Browser,
  tempRoot: string,
  mode: { label: string; env: string | undefined; expected: boolean },
): Promise<void> {
  console.log(`${mode.label}: starting production server`)
  const server = await startServer(tempRoot, mode.label, mode.env)
  try {
    await inspectUnauthenticatedBoundary(server)
    const cookie = await login(server.baseUrl)
    console.log(`${mode.label}: checking auth boundary, auth API, and dehydrated SSR`)
    await inspectServerContract(server, cookie, mode.expected)
    console.log(`${mode.label}: checking Library, Home, and Workspace presenters`)
    await inspectPresenters(browser, server, cookie, mode.expected)
    console.log(
      `${mode.label}: API newShell=${mode.expected}, SSR newShell=${mode.expected}, presenters exclusive`,
    )
  } finally {
    await stopServer(server.child)
  }
}

assert(fs.existsSync(executable), `Release server missing: ${executable}. Run bun run build first.`)
assert(
  fs.existsSync(path.join(root, 'dist/client/index.html')),
  'Production client missing. Run bun run build first.',
)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-stage1-shell-rollback-'))
const browser = await chromium.launch()
try {
  await verifyMode(browser, tempRoot, { label: 'default', env: undefined, expected: true })
  await verifyMode(browser, tempRoot, { label: 'NEW_SHELL=0', env: '0', expected: false })
  console.log('Stage 1 production shell rollback verification passed')
} finally {
  await browser.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
