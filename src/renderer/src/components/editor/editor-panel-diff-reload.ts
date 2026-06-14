import type { OpenFile } from '@/store/slices/editor'

export function isReloadableSingleFileDiffTab(file: OpenFile): boolean {
  return (
    file.mode === 'diff' &&
    file.diffSource !== undefined &&
    file.diffSource !== 'combined-uncommitted' &&
    file.diffSource !== 'combined-branch' &&
    file.diffSource !== 'combined-commit'
  )
}

export function shouldReloadDiffOnGitStatusChange(file: OpenFile): boolean {
  return file.mode === 'diff' && (file.diffSource === 'unstaged' || file.diffSource === 'staged')
}

// Why: re-clicking an open diff tab bumps its reload nonce. P5 keeps the stale
// diff on screen during the forced refetch (no pre-delete blank), so reload only
// when content is already loaded — an absent entry means the first-open fetch is
// still in flight and forcing here would duplicate the git-diff RPC (mirrors the
// git-status reload guard).
export function shouldForceReloadDiffOnNonceBump(
  file: OpenFile,
  reloadNonce: number | undefined,
  hasLoadedDiffContent: boolean
): boolean {
  if (reloadNonce === undefined || reloadNonce === 0) {
    return false
  }
  if (!isReloadableSingleFileDiffTab(file)) {
    return false
  }
  return hasLoadedDiffContent
}
