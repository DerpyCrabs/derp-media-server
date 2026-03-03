import { getEditableFolders } from '@/lib/file-system'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'

export default async function WorkspacePage() {
  const editableFolders = getEditableFolders()

  return <WorkspaceShell editableFolders={editableFolders} />
}
