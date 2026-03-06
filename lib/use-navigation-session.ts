import { useUrlState } from '@/lib/use-url-state'
import type { NavigationSession } from '@/lib/navigation-session'

export function useNavigationSession(session?: NavigationSession): NavigationSession {
  const urlSession = useUrlState()
  return session ?? urlSession
}
