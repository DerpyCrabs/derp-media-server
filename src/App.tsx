import { usePathname } from '@/lib/router'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { SharePage } from './pages/SharePage'

export function App() {
  const pathname = usePathname()
  const shareMatch = pathname.match(/^\/share\/([^/]+)/)

  if (pathname === '/login') return <LoginPage />
  if (shareMatch) return <SharePage token={shareMatch[1]} />
  return <HomePage />
}
