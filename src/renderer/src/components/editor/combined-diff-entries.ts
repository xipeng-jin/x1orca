import type { OpenFile } from '@/store/slices/editor'
import { getWorkingTreeDiffOldPath } from '@/lib/git-diff-old-path-policy'
import type { GitBranchChangeEntry, GitStatusEntry } from '../../../../shared/types'

/**
 * Fallback filtering for combined-diff tabs that were opened before the
 * snapshot field existed. When a snapshot is present the caller should use it
 * directly (after filtering out unresolved conflicts) instead of calling this.
 */
export function getCombinedUncommittedEntries(
  liveEntries: GitStatusEntry[],
  areaFilter: OpenFile['combinedAreaFilter']
): GitStatusEntry[] {
  return liveEntries.filter((entry) => {
    if (entry.conflictStatus === 'unresolved') {
      return false
    }
    if (areaFilter) {
      return entry.area === areaFilter
    }
    return entry.area !== 'untracked'
  })
}

export function getCombinedBranchEntries(
  snapshotEntries: readonly GitBranchChangeEntry[] | undefined,
  liveEntries: readonly GitBranchChangeEntry[]
): GitBranchChangeEntry[] {
  // Why: an explicitly empty tab snapshot should stay empty instead of drifting
  // to later Source Control refreshes.
  return [...(snapshotEntries ?? liveEntries)]
}

export function getCombinedUncommittedEntryDiffOldPath(entry: GitStatusEntry): string | undefined {
  return getWorkingTreeDiffOldPath({
    oldPath: entry.oldPath,
    diffSource: entry.area === 'staged' ? 'staged' : 'unstaged',
    diffStatus: entry.status
  })
}
