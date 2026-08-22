import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { applyWorkspacePathMutation } from '@/workspace/model/workspace-path-mutation'
import { useWorkspaceRegistry } from './use-workspace-registry'
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
} from 'solid-js'
import type { JSX } from '@solidjs/web'

export type WorkspaceSession = ReturnType<typeof useWorkspaceRegistry> & {
  registerSavingBlocker: (blocked: Accessor<boolean>) => () => void
}

const WorkspaceSessionContext = createContext<WorkspaceSession>()

export function WorkspaceSessionProvider(props: {
  workspaceId: Accessor<string>
  children: JSX.Element
}) {
  const [savingBlockers, setSavingBlockers] = createSignal<Accessor<boolean>[]>([])
  const savingWaiters = new Set<() => void>()

  const registerSavingBlocker = (blocked: Accessor<boolean>) => {
    let disposed = false
    queueMicrotask(() => {
      if (disposed) return
      setSavingBlockers((current) => (current.includes(blocked) ? current : [...current, blocked]))
    })
    return () => {
      disposed = true
      setSavingBlockers((current) => current.filter((item) => item !== blocked))
    }
  }

  const savingBlocked = () => savingBlockers().some((blocked) => blocked())
  createEffect(savingBlocked, (blocked) => {
    if (blocked) return
    for (const resolve of savingWaiters) resolve()
    savingWaiters.clear()
  })
  onCleanup(() => {
    for (const resolve of savingWaiters) resolve()
    savingWaiters.clear()
  })

  const session = useWorkspaceRegistry({
    workspaceId: () => props.workspaceId(),
    savingBlocked,
    waitUntilSavingUnblocked: () =>
      savingBlocked()
        ? new Promise<void>((resolve) => savingWaiters.add(resolve))
        : Promise.resolve(),
  })
  useAdminEventsStream(
    true,
    (mutation) => {
      const current = session.document.value()
      if (current) session.document.replace(applyWorkspacePathMutation(current, mutation))
      void session.catalog.reconcileRemoteChange()
    },
    () => void session.catalog.reconcileRemoteChange(),
  )

  const publicSession: WorkspaceSession = {
    ...session,
    registerSavingBlocker,
  }

  return <WorkspaceSessionContext value={publicSession}>{props.children}</WorkspaceSessionContext>
}

export function useWorkspaceSession(options?: { savingBlocked?: Accessor<boolean> }) {
  const session = useContext(WorkspaceSessionContext)
  if (!session) throw new Error('WorkspaceSessionProvider is missing')
  if (options?.savingBlocked) onCleanup(session.registerSavingBlocker(options.savingBlocked))
  return session
}
