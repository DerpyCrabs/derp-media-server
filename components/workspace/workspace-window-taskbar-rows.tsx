import { memo, useRef, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { WorkspaceTaskbarWindowButton } from '@/components/workspace/layout'
import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'
import {
  selectGroupTabs,
  selectOrderedGroupIds,
  useWorkspaceSessionStore,
} from '@/lib/workspace-session-store'

export type TaskbarGetIcon = (
  type: MediaType,
  filePath: string,
  isAudioFile?: boolean,
  isVideoFile?: boolean,
  isVirtual?: boolean,
) => ReactNode

export interface WorkspaceWindowTaskbarRowsProps {
  storageKey: string
  handledByMouseDownRef: RefObject<boolean>
  getIcon: TaskbarGetIcon
  focusWindow: (windowId: string) => void
  setWindowMinimized: (windowId: string, minimized: boolean) => void
  closeWindow: (windowId: string) => void
}

const TaskbarWindowGroupRow = memo(function TaskbarWindowGroupRow({
  storageKey,
  groupId,
  getIconRef,
  handledByMouseDownRef,
  focusWindow,
  setWindowMinimized,
  closeWindow,
}: Omit<WorkspaceWindowTaskbarRowsProps, 'getIcon'> & {
  groupId: string
  getIconRef: RefObject<TaskbarGetIcon>
}) {
  const playingPath = useWorkspacePlaybackStore((s) => s.byKey[storageKey]?.playing ?? null)
  const groupWindows = useWorkspaceSessionStore(
    useShallow((s) => selectGroupTabs(s.sessions, storageKey, groupId)),
  )
  const activeWindowId = useWorkspaceFocusStore((s) => s.byKey[storageKey]?.activeWindowId ?? null)
  const activeTabFromMap = useWorkspaceFocusStore(
    (s) => s.byKey[storageKey]?.activeTabMap?.[groupId],
  )

  const leader = groupWindows[0]
  const activeTabId = activeTabFromMap ?? leader?.id
  const displayWindow: WorkspaceWindowDefinition | undefined =
    groupWindows.find((w) => w.id === activeTabId) ?? leader ?? groupWindows[0]
  if (!displayWindow || !leader) return null

  const tabCount = groupWindows.length
  const rowLabel = tabCount > 1 ? `${displayWindow.title} (+${tabCount - 1})` : displayWindow.title
  const path =
    displayWindow.iconPath ??
    (displayWindow.type === 'browser'
      ? (displayWindow.initialState.dir ?? '')
      : displayWindow.type === 'player'
        ? (playingPath ?? '')
        : (displayWindow.initialState.viewing ?? ''))
  const isDir = displayWindow.type === 'browser'
  const tooltip = path ? `${isDir ? 'Folder' : 'File'}: ${path}` : displayWindow.title
  const dragData =
    path && displayWindow.source
      ? {
          path,
          isDirectory: isDir,
          sourceKind: displayWindow.source.kind,
          sourceToken: displayWindow.source.token,
        }
      : undefined

  return (
    <WorkspaceTaskbarWindowButton
      id={groupId}
      label={rowLabel}
      icon={getIconRef.current(
        displayWindow.iconType ??
          (displayWindow.type === 'browser'
            ? MediaType.FOLDER
            : displayWindow.type === 'player'
              ? MediaType.VIDEO
              : displayWindow.initialState.viewing
                ? getMediaType(displayWindow.initialState.viewing.split('.').pop() ?? '')
                : MediaType.OTHER),
        displayWindow.iconPath ??
          (displayWindow.type === 'browser'
            ? (displayWindow.initialState.dir ?? '')
            : displayWindow.type === 'player'
              ? (playingPath ?? '')
              : (displayWindow.initialState.viewing ?? '')),
        (displayWindow.iconType ?? MediaType.OTHER) === MediaType.AUDIO,
        (displayWindow.iconType ??
          (displayWindow.type === 'player' ? MediaType.VIDEO : MediaType.OTHER)) ===
          MediaType.VIDEO,
        displayWindow.iconIsVirtual ?? false,
      )}
      tooltip={tooltip}
      onSelect={() => {
        const leaderId = leader?.id ?? groupWindows[0]?.id
        const isMinimized = leader?.layout?.minimized ?? false
        const isActive = groupWindows.some((w) => w.id === activeWindowId)
        if (isMinimized) {
          focusWindow(leaderId)
        } else if (isActive) {
          setWindowMinimized(leaderId, true)
        } else {
          focusWindow(leaderId)
        }
      }}
      onClose={() => {
        for (const w of groupWindows) {
          if (w.type === 'player') useWorkspacePlaybackStore.getState().closePlayer(storageKey)
          closeWindow(w.id)
        }
      }}
      closeLabel={`Close ${rowLabel}`}
      closeIcon={X}
      active={groupWindows.some((w) => w.id === activeWindowId)}
      dragData={dragData}
      handledByMouseDownRef={handledByMouseDownRef}
    />
  )
})

export function WorkspaceWindowTaskbarRows(props: WorkspaceWindowTaskbarRowsProps) {
  const {
    storageKey,
    handledByMouseDownRef,
    getIcon,
    focusWindow,
    setWindowMinimized,
    closeWindow,
  } = props
  const getIconRef = useRef<TaskbarGetIcon>(getIcon)
  getIconRef.current = getIcon

  const orderedGroupIds = useWorkspaceSessionStore(
    useShallow((s) => selectOrderedGroupIds(s.sessions, storageKey)),
  )

  return (
    <>
      {orderedGroupIds.map((groupId) => (
        <TaskbarWindowGroupRow
          key={groupId}
          storageKey={storageKey}
          groupId={groupId}
          handledByMouseDownRef={handledByMouseDownRef}
          getIconRef={getIconRef}
          focusWindow={focusWindow}
          setWindowMinimized={setWindowMinimized}
          closeWindow={closeWindow}
        />
      ))}
    </>
  )
}
