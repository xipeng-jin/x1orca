import type { OpenFile } from '@/store/slices/editor'
import type { WorkspaceVisibleTabType } from '../../../../shared/types'

type ActiveDiffTabState = {
  openFiles: readonly OpenFile[]
  activeFileIdByWorktree: Record<string, string | null>
  activeTabTypeByWorktree: Record<string, WorkspaceVisibleTabType>
}

// Why: scroll-to-note must not reopen the diff the user is already viewing.
// Reopening bumps diffContentReloadNonce, rotates the DiffViewer key, and
// remounts the Pierre CodeView — which resets scroll and races the
// scroll-to-note poll (the "nothing happens" bug). When the active editor tab
// already is this file's diff, the caller should only stamp the scroll request
// against the live, already-rendered instance.
export function isWorktreeDiffTabActiveForFile(
  state: ActiveDiffTabState,
  worktreeId: string,
  relativePath: string
): boolean {
  if (state.activeTabTypeByWorktree[worktreeId] !== 'editor') {
    return false
  }
  const activeFileId = state.activeFileIdByWorktree[worktreeId]
  if (!activeFileId) {
    return false
  }
  const activeFile = state.openFiles.find((file) => file.id === activeFileId)
  return Boolean(
    activeFile &&
    activeFile.mode === 'diff' &&
    activeFile.worktreeId === worktreeId &&
    activeFile.relativePath === relativePath
  )
}
