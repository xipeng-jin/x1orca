import type { GitFileStatus } from '../../../shared/types'

type UncommittedDiffSource = 'staged' | 'unstaged'

export function getWorkingTreeDiffOldPath({
  oldPath,
  diffSource,
  diffStatus,
  compareAgainstHead = false
}: {
  oldPath?: string
  diffSource?: UncommittedDiffSource
  diffStatus?: GitFileStatus
  compareAgainstHead?: boolean
}): string | undefined {
  if (!oldPath) {
    return undefined
  }
  if (diffSource === 'staged' || compareAgainstHead) {
    return oldPath
  }
  // Why: porcelain v2 type-2 records can attach the rename source to the
  // unstaged edit companion; that diff must still compare index:new -> WT:new.
  return diffSource === 'unstaged' && diffStatus === 'renamed' ? oldPath : undefined
}
