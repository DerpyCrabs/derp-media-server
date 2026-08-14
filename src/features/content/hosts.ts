import type { CanvasHost, HostOpenPlan, LibraryHost, WorkspaceHost } from './contracts'

type CommonHostCallbacks = Readonly<{
  close(instanceId: string): void
  focus(instanceId: string): void
}>

export type LibraryHostCallbacks = CommonHostCallbacks &
  Readonly<{
    replace(plan: HostOpenPlan<'replace'>): void
    modal(plan: HostOpenPlan<'modal'>): void
    fullscreen(plan: HostOpenPlan<'fullscreen'>): void
  }>

export type WorkspaceHostCallbacks = CommonHostCallbacks &
  Readonly<{
    replace(plan: HostOpenPlan<'replace'>): void
    pane(plan: HostOpenPlan<'pane'>): void
    window(plan: HostOpenPlan<'window'>): void
  }>

export type CanvasHostCallbacks = CommonHostCallbacks &
  Readonly<{
    window(plan: HostOpenPlan<'window'>): void
  }>

export function createLibraryHost(callbacks: LibraryHostCallbacks): LibraryHost {
  return Object.freeze({
    surface: 'library' as const,
    open(plan: HostOpenPlan<'replace' | 'modal' | 'fullscreen'>) {
      switch (plan.disposition) {
        case 'replace':
          return callbacks.replace(plan as HostOpenPlan<'replace'>)
        case 'modal':
          return callbacks.modal(plan as HostOpenPlan<'modal'>)
        case 'fullscreen':
          return callbacks.fullscreen(plan as HostOpenPlan<'fullscreen'>)
        default:
          throw new Error(`Library host cannot place ${plan.disposition} content`)
      }
    },
    close: callbacks.close,
    focus: callbacks.focus,
  })
}

export function createWorkspaceHost(callbacks: WorkspaceHostCallbacks): WorkspaceHost {
  return Object.freeze({
    surface: 'workspace' as const,
    open(plan: HostOpenPlan<'replace' | 'pane' | 'window'>) {
      switch (plan.disposition) {
        case 'replace':
          return callbacks.replace(plan as HostOpenPlan<'replace'>)
        case 'pane':
          return callbacks.pane(plan as HostOpenPlan<'pane'>)
        case 'window':
          return callbacks.window(plan as HostOpenPlan<'window'>)
        default:
          throw new Error(`Workspace host cannot place ${plan.disposition} content`)
      }
    },
    close: callbacks.close,
    focus: callbacks.focus,
  })
}

export function createCanvasHost(callbacks: CanvasHostCallbacks): CanvasHost {
  return Object.freeze({
    surface: 'canvas' as const,
    open(plan: HostOpenPlan<'window'>) {
      if (plan.disposition !== 'window') {
        throw new Error(`Canvas host cannot place ${plan.disposition} content`)
      }
      callbacks.window(plan)
    },
    close: callbacks.close,
    focus: callbacks.focus,
  })
}
