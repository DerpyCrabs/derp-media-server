import type { ViewerId } from '@/lib/resource'
import { createComponent, mergeProps } from 'solid-js'
import {
  WorkspaceViewerPane,
  type WorkspaceViewerPaneProps,
} from '../../workspace/WorkspaceViewerPane'

export function createViewerPaneAdapter(viewerId: ViewerId) {
  return function ViewerPaneAdapter(props: WorkspaceViewerPaneProps) {
    return createComponent(WorkspaceViewerPane, mergeProps({ viewerId }, props))
  }
}
