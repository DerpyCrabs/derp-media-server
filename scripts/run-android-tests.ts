import { spawn } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const PORT = 3102
const certPath = path.join(ROOT, '.certs', 'dev-local.cert.pem')
const keyPath = path.join(ROOT, '.certs', 'dev-local.key.pem')
const androidStudioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr'
const commandShell = process.env.ComSpec ?? path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'cmd.exe')
const sdkRoot =
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
const adb = path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const androidRoot = path.join(ROOT, 'android')

function run(command: string, args: string[], env = process.env, cwd = ROOT): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))))
  })
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

function waitForExit(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise<void>((resolve) => child.once('exit', () => resolve()))
}

async function waitForPort(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portIsOpen(port)) return
    await Bun.sleep(250)
  }
  throw new Error(`Timed out waiting for the Android test server on port ${port}`)
}

async function reverseExists() {
  const result = Bun.spawnSync([adb, 'reverse', '--list'])
  const output = new TextDecoder().decode(result.stdout)
  return output.split(/\r?\n/).some((line) => line.trim() === `tcp:${PORT} tcp:${PORT}`)
}

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  throw new Error('Android tests require .certs/dev-local.cert.pem and .certs/dev-local.key.pem')
}
if (!fs.existsSync(adb)) throw new Error(`Android SDK platform tools were not found: ${adb}`)

const testEnv: Record<string, string | undefined> = {
  ...process.env,
  PORT: String(PORT),
  TLS_CERT_PATH: certPath,
  TLS_KEY_PATH: keyPath,
}
if (fs.existsSync(androidStudioJbr)) {
  testEnv.JAVA_HOME = androidStudioJbr
  testEnv.PATH = `${path.join(androidStudioJbr, 'bin')}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`
}

const serverAlreadyRunning = await portIsOpen(PORT)
const server = serverAlreadyRunning
  ? undefined
  : spawn(process.execPath, ['run', 'dev'], { cwd: ROOT, env: testEnv, stdio: 'inherit', shell: false })
const reverseAlreadyPresent = await reverseExists()

try {
  if (!serverAlreadyRunning) await waitForPort(PORT, 15_000)
  if (!reverseAlreadyPresent) await run(adb, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`])
  if (process.platform === 'win32') {
    await run(commandShell, ['/d', '/s', '/c', 'gradlew.bat connectedDebugAndroidTest'], testEnv, androidRoot)
  } else {
    await run('./gradlew', ['connectedDebugAndroidTest'], testEnv, androidRoot)
  }
} finally {
  if (!reverseAlreadyPresent) await run(adb, ['reverse', '--remove', `tcp:${PORT}`]).catch(() => {})
  if (server) {
    if (process.platform === 'win32') {
      Bun.spawnSync([commandShell, '/d', '/s', '/c', `taskkill /PID ${server.pid} /T /F >nul 2>&1`])
    } else {
      server.kill()
    }
    await waitForExit(server)
  }
}
