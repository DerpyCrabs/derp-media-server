import type { ReactElement } from 'react'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SharePage } from './pages/SharePage'

interface ResolvedRoute {
  key: string
  element: ReactElement
}

export function resolveRoute(pathname: string): ResolvedRoute {
  if (pathname === '/login') {
    return { key: 'login', element: <LoginPage /> }
  }

  const shareMatch = pathname.match(/^\/share\/([^/]+)/)
  if (shareMatch) {
    return { key: 'share', element: <SharePage token={shareMatch[1]} /> }
  }

  return { key: 'home', element: <HomePage /> }
}
