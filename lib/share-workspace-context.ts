import { createContext, useContext } from 'react'

export interface ShareRestrictions {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

export interface ShareWorkspaceInfo {
  token: string
  name: string
  path: string
  editable: boolean
  restrictions?: ShareRestrictions
  isKnowledgeBase: boolean
}

export const ShareWorkspaceContext = createContext<ShareWorkspaceInfo | null>(null)

export function useShareWorkspace(): ShareWorkspaceInfo | null {
  return useContext(ShareWorkspaceContext)
}
