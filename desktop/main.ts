import { readWaylandFiles, writeWaylandFiles } from './wayland-clipboard'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from 'electron'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  configDirectory,
  DesktopServer,
  fileUris,
  loadConfig,
  parseArguments,
  parseFileClipboard,
} from './core'
import type { DesktopTarget } from '../src/desktop/bridge'

app.setName('Derp Media Server')
app.setDesktopName('derp-media-client.desktop')
app.commandLine.appendSwitch('class', 'derp-media-client')
const configDir = configDirectory()
const assetsDir = app.getAppPath()
const stateDir = path.join(
  process.env.XDG_STATE_HOME || path.join(app.getPath('home'), '.local/state'),
  'derp-media-server/desktop',
)
mkdirSync(stateDir, { recursive: true })
app.setPath('userData', stateDir)

function applicationArguments(argv: string[], cwd: string) {
  const entry = path.join(assetsDir, 'main.cjs')
  const index = argv.findIndex((argument) => path.resolve(cwd, argument) === entry)
  return argv.slice(index >= 0 ? index + 1 : 1)
}
const args = applicationArguments(process.argv, process.cwd())
const help =
  'Usage: derp-media-client [--tray] [--] [FILE_OR_DIRECTORY ...]\nEach path opens a new window. With no paths, open the library.\nConfig: ' +
  path.join(configDir, 'desktop.json')
let initial: ReturnType<typeof parseArguments>
try {
  initial = parseArguments(args, process.cwd())
} catch (error) {
  console.error(String(error))
  app.exit(1)
  throw error
}
if (initial.help) {
  console.log(help)
  app.exit(0)
}

let server: DesktopServer
let tray: Tray | undefined
let spare: BrowserWindow | undefined
let quitting = false
const readyWindows = new Set<number>()
const closingWindows = new Set<number>()
const approvedClose = new Set<number>()
const pending = new Map<number, DesktopTarget>()
const rootTarget: DesktopTarget = { path: '', isDirectory: true, mediaType: 'folder' }
const queued = [initial]

function report(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  dialog.showErrorBox('Derp Media Server', message)
}

function allowed(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.origin === server.origin && parsed.pathname === '/desktop'
  } catch {
    return false
  }
}

function authorize(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (event.senderFrame !== event.sender.mainFrame || !allowed(event.senderFrame.url))
    throw new Error('Desktop integration is only available to the desktop page')
}

function deliver(win: BrowserWindow, target: DesktopTarget) {
  if (readyWindows.has(win.webContents.id)) {
    win.webContents.send('desktop:open-target', target)
    win.show()
  } else pending.set(win.webContents.id, target)
}

function newWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 280,
    show: false,
    title: 'Derp Media Server',
    icon: path.join(assetsDir, 'icon.png'),
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(assetsDir, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const contentsId = win.webContents.id
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) readyWindows.delete(contentsId)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) event.preventDefault()
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!allowed(url)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', () => {
    if (!quitting)
      report(new Error('A desktop window stopped responding. Reopen it from the tray or CLI.'))
    win.destroy()
  })
  win.on('close', (event) => {
    if (readyWindows.has(contentsId) && !approvedClose.has(contentsId)) {
      event.preventDefault()
      if (!closingWindows.has(contentsId)) {
        closingWindows.add(contentsId)
        win.webContents.send('desktop:before-close')
      }
    }
  })
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep editing', 'Discard changes'],
      defaultId: 0,
      cancelId: 0,
      message: 'This document has unsaved changes.',
    })
    if (choice === 1) event.preventDefault()
    else quitting = false
  })
  win.on('closed', () => {
    closingWindows.delete(contentsId)
    approvedClose.delete(contentsId)
    readyWindows.delete(contentsId)
    pending.delete(contentsId)
    if (spare === win) spare = undefined
  })
  void win.loadURL(server.origin + '/desktop?warm=1').catch((error: unknown) => {
    if (!win.isDestroyed() && win !== spare) {
      report(error)
      win.destroy()
    }
  })
  return win
}

function prepareSpare() {
  if (!quitting && (!spare || spare.isDestroyed())) spare = newWindow()
}

function openTarget(target: DesktopTarget) {
  if (target.mediaType === 'audio')
    throw new Error('Audio playback is not included in the desktop client yet.')
  const win = spare && !spare.isDestroyed() ? spare : newWindow()
  spare = undefined
  deliver(win, target)
  setTimeout(() => {
    if (!win.isDestroyed() && pending.has(win.webContents.id)) {
      report(
        new Error(
          `Cannot load the desktop UI at ${server.origin}. Start an updated server and check ${path.join(configDir, 'desktop.json')}.`,
        ),
      )
      win.destroy()
    }
  }, 15_000).unref()
  // A failed warm-up must not strand an explicit open request.
  if (!readyWindows.has(win.webContents.id) && !win.webContents.isLoading())
    void win.loadURL(server.origin + '/desktop?warm=1').catch((error: unknown) => {
      report(error)
      win.destroy()
    })
  setTimeout(prepareSpare, 300)
}

async function openPaths(paths: string[]) {
  for (const file of paths) {
    try {
      openTarget(await server.resolve(file, true))
    } catch (error) {
      report(error)
    }
  }
}

async function handleRequest(request: ReturnType<typeof parseArguments>) {
  if (request.help) return
  if (request.paths.length) await openPaths(request.paths)
  else if (!request.tray) openTarget(rootTarget)
}

async function fileClipboard(): Promise<string[]> {
  if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) return readWaylandFiles()
  const items = await clipboard.read()
  for (const item of items) {
    for (const type of item.types) {
      if (type !== 'text/uri-list' && !type.includes('x-special/gnome-copied-files')) continue
      const value = await item.getType(type)
      if ('text' in value) {
        const paths = parseFileClipboard(await value.text())
        if (paths.length) return paths
      }
    }
  }
  return []
}

function registerIpc() {
  const handle = (
    name: string,
    callback: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
  ) =>
    ipcMain.handle('desktop:' + name, (event, ...args: unknown[]) => {
      authorize(event)
      return callback(event, ...args)
    })
  handle('ready', (event) => {
    readyWindows.add(event.sender.id)
    const target = pending.get(event.sender.id)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (target && win) {
      pending.delete(event.sender.id)
      deliver(win, target)
    }
  })
  handle('close-ready', (event, error?: string) => {
    closingWindows.delete(event.sender.id)
    if (error) {
      quitting = false
      report(new Error(error))
      return
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      approvedClose.add(event.sender.id)
      win.close()
      approvedClose.delete(event.sender.id)
    }
  })
  handle('open', async (_event, logical: string, reader: boolean) => {
    openTarget(
      logical === '' && !reader
        ? rootTarget
        : { ...(await server.resolve(logical)), reader: reader === true },
    )
  })
  handle('root', () => openTarget(rootTarget))
  handle('open-files', async (_event, paths: string[]) => {
    await openPaths(paths)
  })
  handle('copy', async (_event, paths: string[]) => {
    const resolved = await Promise.all(paths.map((file) => server.resolve(file)))
    const files = resolved.map((file) => file.absolutePath)
    if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) return writeWaylandFiles(files)
    const uris = fileUris(files)
    await clipboard.write([
      new ClipboardItem({
        'text/uri-list': new Blob([uris]),
        'electron application/osclipboard;format="x-special/gnome-copied-files"': new Blob([
          'copy\n' + uris.replaceAll('\r\n', '\n'),
        ]),
      }),
    ])
  })
  handle('drag', async (event, paths: string[]) => {
    const resolved = await Promise.all(paths.map((file) => server.resolve(file)))
    if (resolved.length)
      event.sender.startDrag({
        file: resolved[0]!.absolutePath,
        files: resolved.map((file) => file.absolutePath),
        icon: nativeImage.createFromPath(path.join(assetsDir, 'icon.png')),
      })
  })
  handle('has-files', async () => (await fileClipboard()).length > 0)
  handle('paste', async (_event, directory: string) =>
    server.importFiles(await fileClipboard(), directory),
  )
  handle('import', async (_event, paths: string[], directory: string) =>
    server.importFiles(paths, directory),
  )
  ipcMain.on('desktop:close', (event) => {
    authorize(event)
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

if (!initial.help && !app.requestSingleInstanceLock()) app.quit()
else if (!initial.help) {
  app.on('second-instance', (_event, argv, cwd) => {
    try {
      const request = parseArguments(applicationArguments(argv, cwd), cwd)
      if (server) void handleRequest(request)
      else queued.push(request)
    } catch (error) {
      report(error)
    }
  })
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
  process.on('SIGTERM', () => app.quit())
  process.on('SIGINT', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
  })
  void app
    .whenReady()
    .then(async () => {
      server = new DesktopServer(await loadConfig())
      registerIpc()
      // Do not grant server-rendered content arbitrary native permissions.
      const { session } = await import('electron')
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(_permission === 'clipboard-sanitized-write' || _permission === 'fullscreen'),
      )
      session.defaultSession.setPermissionCheckHandler(
        (_contents, permission) =>
          permission === 'clipboard-sanitized-write' || permission === 'fullscreen',
      )
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'File',
            submenu: [
              {
                label: 'New browser window',
                accelerator: 'Ctrl+N',
                click: () => openTarget(rootTarget),
              },
              { role: 'close' },
              { role: 'quit' },
            ],
          },
          { role: 'editMenu' },
          {
            label: 'View',
            submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }],
          },
        ]),
      )
      tray = new Tray(nativeImage.createFromPath(path.join(assetsDir, 'icon.png')))
      tray.setToolTip('Derp Media Server')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'New browser window', click: () => openTarget(rootTarget) },
          { label: 'Quit', click: () => app.quit() },
        ]),
      )
      tray.on('click', () => openTarget(rootTarget))
      prepareSpare()
      for (const request of queued.splice(0)) await handleRequest(request)
    })
    .catch((error: unknown) => {
      report(error)
      app.quit()
    })
}
