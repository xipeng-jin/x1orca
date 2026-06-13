import type { GitStatusEntry } from '../../../../shared/types'
import { buildDiffEditorFileId, type OpenFile } from '@/store/slices/editor'
import { detectLanguage } from '@/lib/language-detect'
import { getWorkingTreeDiffOldPath } from '@/lib/git-diff-old-path-policy'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { fetchEditorDiffContent } from '@/components/editor/editor-content-fetch'

const HOVER_PREFETCH_DEBOUNCE_MS = 100
// Why: bound speculative RPCs so sweeping the pointer down the file list
// cannot flood slow (e.g. SSH) connections.
const HOVER_PREFETCH_MAX_IN_FLIGHT = 2

const hoverPrefetchesInFlight = new Set<string>()

export type SourceControlDiffPrefetchTarget = {
  worktreeId: string
  worktreePath: string
  entry: GitStatusEntry
}

export type SourceControlDiffHoverPrefetch = {
  cancel: () => void
}

/**
 * Why: mirrors openSourceControlEntryDiff routing and the OpenFile that the
 * store's openDiff builds, so a click/hover fetch computes the same in-flight
 * key as the mount-effect fetch and both coalesce into one git-diff RPC.
 * Returns null for rows that do not open a working-tree diff tab (conflict
 * entries and unstaged markdown, which routes to an edit tab in Changes mode).
 */
export function buildSourceControlEntryDiffFetchInput({
  worktreeId,
  worktreePath,
  entry
}: SourceControlDiffPrefetchTarget): OpenFile | null {
  if (entry.conflictKind && entry.conflictStatus) {
    return null
  }
  const language = detectLanguage(entry.path)
  if (language === 'markdown' && entry.area === 'unstaged') {
    return null
  }
  const diffSource = entry.area === 'staged' ? ('staged' as const) : ('unstaged' as const)
  return {
    id: buildDiffEditorFileId(worktreeId, diffSource, entry.path, undefined),
    filePath: joinPath(worktreePath, entry.path),
    relativePath: entry.path,
    worktreeId,
    language,
    isDirty: false,
    mode: 'diff',
    diffSource,
    diffStatus: entry.status,
    branchOldPath: getWorkingTreeDiffOldPath({
      oldPath: entry.oldPath,
      diffSource,
      diffStatus: entry.status
    })
  }
}

/**
 * Fire-and-forget fetch from the click path so the git-diff RPC overlaps React
 * render and lazy-chunk load. While the RPC is in flight the mount-effect fetch
 * coalesces onto it; if it settles first, the result is briefly handed to the
 * imminent mount (keyed by the file's git status signature, so a worktree change
 * invalidates it). Either way the open costs one RPC. Errors are swallowed — the
 * mount-effect fetch owns writing results and errors to the store.
 */
export function startSourceControlDiffContentFetch(file: OpenFile): void {
  // Why: re-opening an existing diff tab refetches with force, which bypasses
  // the in-flight entry — a click-time fetch there would just duplicate the RPC.
  if (isDiffTabAlreadyOpen(file.id)) {
    return
  }
  void fetchEditorDiffContent(file, { prefetch: 'click-open' }).catch(() => undefined)
}

/**
 * Debounced hover prefetch. Cancelling before the debounce fires issues no
 * RPC. Returns null when the row does not route to a working-tree diff tab.
 */
export function scheduleSourceControlDiffHoverPrefetch(
  target: SourceControlDiffPrefetchTarget
): SourceControlDiffHoverPrefetch | null {
  const file = buildSourceControlEntryDiffFetchInput(target)
  if (!file) {
    return null
  }
  const timer = setTimeout(() => {
    if (
      hoverPrefetchesInFlight.size >= HOVER_PREFETCH_MAX_IN_FLIGHT ||
      hoverPrefetchesInFlight.has(file.id) ||
      isDiffTabAlreadyOpen(file.id)
    ) {
      return
    }
    hoverPrefetchesInFlight.add(file.id)
    const settle = (): void => {
      hoverPrefetchesInFlight.delete(file.id)
    }
    void fetchEditorDiffContent(file, { prefetch: 'hover' }).then(settle, settle)
  }, HOVER_PREFETCH_DEBOUNCE_MS)
  return {
    cancel: () => clearTimeout(timer)
  }
}

function isDiffTabAlreadyOpen(fileId: string): boolean {
  return useAppStore.getState().openFiles.some((open) => open.id === fileId)
}

export function resetSourceControlDiffHoverPrefetchForTests(): void {
  hoverPrefetchesInFlight.clear()
}
