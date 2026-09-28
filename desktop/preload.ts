import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopBridge, DesktopTarget } from '../src/desktop/bridge'

const pathsForFiles = (files: File[]) =>
  files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
const bridge: DesktopBridge = {
  ready: () => ipcRenderer.invoke('desktop:ready'),
  onBeforeClose(callback) {
    const listener = () => {
      void callback().then(
        () => ipcRenderer.invoke('desktop:close-ready'),
        (error: unknown) => ipcRenderer.invoke('desktop:close-ready', String(error)),
      )
    }
    ipcRenderer.on('desktop:before-close', listener)
    return () => ipcRenderer.removeListener('desktop:before-close', listener)
  },
  onOpen(callback) {
    const listener = (_event: Electron.IpcRendererEvent, target: DesktopTarget) => callback(target)
    ipcRenderer.on('desktop:open-target', listener)
    return () => ipcRenderer.removeListener('desktop:open-target', listener)
  },
  open: (path, reader) => ipcRenderer.invoke('desktop:open', path, reader),
  openRoot: () => ipcRenderer.invoke('desktop:root'),
  copy: (paths) => ipcRenderer.invoke('desktop:copy', paths),
  drag: (paths) => ipcRenderer.invoke('desktop:drag', paths),
  paste: (directory) => ipcRenderer.invoke('desktop:paste', directory),
  hasFileClipboard: () => ipcRenderer.invoke('desktop:has-files'),
  importDrop: (files, directory) =>
    ipcRenderer.invoke('desktop:import', pathsForFiles(files), directory),
  openDrop: (files) => ipcRenderer.invoke('desktop:open-files', pathsForFiles(files)),
  close: () => ipcRenderer.send('desktop:close'),
}
contextBridge.exposeInMainWorld('derpDesktop', bridge)
