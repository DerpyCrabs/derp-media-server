import { usePathname } from '@/lib/router'
import { resolveRoute } from './routes'

export function App() {
  const pathname = usePathname()
  return resolveRoute(pathname).element
}
