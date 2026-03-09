import type { ReactElement } from 'react'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SharePage } from './pages/SharePage'
import { ShareWorkspacePage } from './pages/ShareWorkspacePage'
import { WorkspacePage } from './pages/WorkspacePage'

interface ResolvedRoute {
  key: string
  element: ReactElement
}

export function resolveRoute(pathname: string): ResolvedRoute {
  if (pathname === '/login') {
    return { key: 'login', element: <LoginPage /> }
  }

  const shareWorkspaceMatch = pathname.match(/^\/share\/([^/]+)\/workspace$/)
  if (shareWorkspaceMatch) {
    return {
      key: 'share-workspace',
      element: <ShareWorkspacePage token={shareWorkspaceMatch[1]} />,
    }
  }

  const shareMatch = pathname.match(/^\/share\/([^/]+)/)
  if (shareMatch) {
    return { key: 'share', element: <SharePage token={shareMatch[1]} /> }
  }

  if (pathname === '/workspace') {
    return { key: 'workspace', element: <WorkspacePage /> }
  }

  return { key: 'home', element: <HomePage /> }
}
