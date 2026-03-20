import { navigateSearchParams } from '../browser-history'

export function navigateToFolder(path: string | null) {
  navigateSearchParams({ dir: path === '' || path == null ? null : path }, 'push')
}
