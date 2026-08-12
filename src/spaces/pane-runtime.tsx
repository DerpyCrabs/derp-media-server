import type { Accessor, JSX, Setter } from 'solid-js'
import { createContext, createSignal, useContext } from 'solid-js'
import type { PaneExplorerRuntime } from '../explorer/browser-adapters'

export type PaneViewerRuntime = Readonly<{
  zoom: Accessor<number | 'fit'>
  setZoom: Setter<number | 'fit'>
  rotation: Accessor<number>
  setRotation: Setter<number>
  imagePath: Accessor<string>
  setImagePath: Setter<string>
  readOnlyView: Accessor<boolean>
  setReadOnlyView: Setter<boolean>
}>

export type SpacePaneRuntime = Readonly<{
  spaceId: string
  viewer(paneId: string): PaneViewerRuntime
  browser(paneId: string): PaneExplorerRuntime
  activePath(paneId: string): string | undefined
  forget(paneId: string): void
  dispose(): void
}>

type PaneRuntimeRecord = {
  viewer: PaneViewerRuntime
  browser: PaneExplorerRuntime
}

function createViewerRuntime(): PaneViewerRuntime {
  const [zoom, setZoom] = createSignal<number | 'fit'>('fit')
  const [rotation, setRotation] = createSignal(0)
  const [imagePath, setImagePath] = createSignal('')
  const [readOnlyView, setReadOnlyView] = createSignal(false)
  return {
    zoom,
    setZoom,
    rotation,
    setRotation,
    imagePath,
    setImagePath,
    readOnlyView,
    setReadOnlyView,
  }
}

function createBrowserRuntime(): PaneExplorerRuntime {
  const [currentPath, setCurrentPath] = createSignal<string>()
  return { currentPath, setCurrentPath }
}

export function createSpacePaneRuntime(spaceId: string): SpacePaneRuntime {
  const panes = new Map<string, PaneRuntimeRecord>()
  const pane = (paneId: string) => {
    let runtime = panes.get(paneId)
    if (!runtime) {
      runtime = { viewer: createViewerRuntime(), browser: createBrowserRuntime() }
      panes.set(paneId, runtime)
    }
    return runtime
  }
  return {
    spaceId,
    viewer(paneId) {
      return pane(paneId).viewer
    },
    browser(paneId) {
      return pane(paneId).browser
    },
    activePath(paneId) {
      return panes.get(paneId)?.browser.currentPath?.()
    },
    forget(paneId) {
      panes.delete(paneId)
    },
    dispose() {
      panes.clear()
    },
  }
}

const PaneRuntimeContext = createContext<SpacePaneRuntime>()

export function PaneRuntimeProvider(props: { runtime: SpacePaneRuntime; children: JSX.Element }) {
  return (
    <PaneRuntimeContext.Provider value={props.runtime}>
      {props.children}
    </PaneRuntimeContext.Provider>
  )
}

export function usePaneRuntime(): SpacePaneRuntime | undefined {
  return useContext(PaneRuntimeContext)
}
