import type { OpenFile } from '@/store/slices/editor'
import { getConnectionId } from '@/lib/connection-context'
import { getWorkingTreeDiffOldPath } from '@/lib/git-diff-old-path-policy'
import { useAppStore } from '@/store'
import {
  getRuntimeFileReadScope,
  readRuntimeFileContent,
  type RuntimeFileReadArgs
} from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import {
  getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff,
  getRuntimeGitDiff,
  getRuntimeGitScope
} from '@/runtime/runtime-git-client'
import type { DiffContent, FileContent } from './editor-panel-content-types'

// Why: module-level (not hook-bound) so non-React callers — e.g. a click/hover
// prefetch — can start a read that coalesces with the mount-effect read. While
// the RPC is in flight, overlapping callers share it (P2 coalescing).
const inFlightFileReads = new Map<string, Promise<FileContent>>()

// Why: 'hover' is speculative and leaves nothing behind once settled. 'click-open'
// belongs to a tab opening right now, so its settled result may be handed to that
// tab's imminent mount fetch (see retainedClickHandoffDiffReads).
export type EditorDiffPrefetchKind = 'hover' | 'click-open'

type InFlightDiffRead = {
  promise: Promise<DiffContent>
  // Why: a store-writing (non-prefetch) caller already received this read.
  consumedByRealRead: boolean
  // Why: a click-open fetch started or joined this read, so a mount is imminent.
  clickHandoff: boolean
  // Why: the status-gated key under which to retain the result on settle.
  handoffKey: string
}
const inFlightDiffReads = new Map<string, InFlightDiffRead>()

// Why: a click-time RPC can settle before React mounts the diff tab; hold the
// result just long enough for that one mount to consume it (one-shot). The
// handoff key embeds the file's git status signature, so a worktree change
// between settle and mount produces a different key — the mount misses it and
// refetches. The handoff is therefore never staler than an already-open diff
// tab, which the reload effect itself refreshes only on a status-signature change.
const CLICK_HANDOFF_RETENTION_MS = 5_000
const retainedClickHandoffDiffReads = new Map<
  string,
  { promise: Promise<DiffContent>; expiry: ReturnType<typeof setTimeout> }
>()

function dropRetainedClickHandoff(handoffKey: string): void {
  const retained = retainedClickHandoffDiffReads.get(handoffKey)
  if (retained) {
    clearTimeout(retained.expiry)
    retainedClickHandoffDiffReads.delete(handoffKey)
  }
}

function retainClickHandoff(handoffKey: string, promise: Promise<DiffContent>): void {
  dropRetainedClickHandoff(handoffKey)
  retainedClickHandoffDiffReads.set(handoffKey, {
    promise,
    expiry: setTimeout(
      () => retainedClickHandoffDiffReads.delete(handoffKey),
      CLICK_HANDOFF_RETENTION_MS
    )
  })
}

export function resetEditorDiffClickHandoffForTests(): void {
  for (const retained of retainedClickHandoffDiffReads.values()) {
    clearTimeout(retained.expiry)
  }
  retainedClickHandoffDiffReads.clear()
}

// Why: each entry must live until its RPC settles so genuinely overlapping
// reads share one request; delete only our own entry — a force refetch may
// have already replaced it with a newer in-flight promise.
function deleteInFlightEntryOnSettle<T>(
  map: Map<string, Promise<T>>,
  key: string,
  pending: Promise<T>
): void {
  const settle = (): void => {
    if (map.get(key) === pending) {
      map.delete(key)
    }
  }
  void pending.then(settle, settle)
}

function inFlightReadKey(connectionId: string | undefined, filePath: string): string {
  return `${connectionId ?? ''}::${filePath}`
}

function inFlightDiffKey(
  file: OpenFile,
  connectionId: string | undefined,
  compareAgainstHead = false,
  effectiveOldPath?: string
): string {
  const branch =
    file.diffSource === 'branch' && file.branchCompare
      ? `${file.branchCompare.baseOid ?? ''}..${file.branchCompare.headOid ?? ''}::${file.branchOldPath ?? ''}`
      : ''
  const commit =
    file.diffSource === 'commit' && file.commitCompare
      ? `${file.commitCompare.parentOid ?? 'empty-tree'}..${file.commitCompare.commitOid}::${file.branchOldPath ?? ''}`
      : ''
  return `${connectionId ?? ''}::${file.diffSource ?? ''}::${compareAgainstHead ? 'head' : 'default'}::${file.filePath}::${effectiveOldPath ?? ''}::${branch}::${commit}`
}

// Why: ties a click-open handoff to the same per-file git status signature the
// diff-reload effect watches, so a worktree change before the mount invalidates
// the handoff. Branch/commit diffs are pinned by their oids in the key already.
function diffHandoffStatusToken(
  file: OpenFile,
  effectiveDiffSource: OpenFile['diffSource']
): string {
  if (effectiveDiffSource !== 'staged' && effectiveDiffSource !== 'unstaged') {
    return ''
  }
  const entries = useAppStore.getState().gitStatusByWorktree[file.worktreeId] ?? []
  return JSON.stringify(
    entries
      .filter((entry) => entry.path === file.relativePath)
      .map((entry) => ({
        area: entry.area,
        status: entry.status,
        conflictStatus: entry.conflictStatus
      }))
  )
}

export function fetchEditorFileContent(
  args: RuntimeFileReadArgs,
  options?: { force?: boolean }
): Promise<FileContent> {
  const readScope = getRuntimeFileReadScope(args.settings, args.connectionId)
  const key = inFlightReadKey(readScope, args.filePath)
  if (options?.force) {
    inFlightFileReads.delete(key)
  }
  let pending = inFlightFileReads.get(key)
  if (!pending) {
    pending = readRuntimeFileContent(args)
    inFlightFileReads.set(key, pending)
    deleteInFlightEntryOnSettle(inFlightFileReads, key, pending)
  }
  return pending
}

export function fetchEditorDiffContent(
  file: OpenFile,
  options?: { force?: boolean; prefetch?: EditorDiffPrefetchKind }
): Promise<DiffContent> {
  const worktreePath = file.filePath.slice(0, file.filePath.length - file.relativePath.length - 1)
  const branchCompare =
    file.branchCompare?.baseOid && file.branchCompare.headOid && file.branchCompare.mergeBase
      ? file.branchCompare
      : null
  const commitCompare = file.commitCompare?.commitOid ? file.commitCompare : null
  const connectionId = getConnectionId(file.worktreeId) ?? undefined
  const activeSettings = useAppStore.getState().settings
  const fileSettings = settingsForRuntimeOwner(activeSettings, file.runtimeEnvironmentId)
  const gitScope = getRuntimeGitScope(fileSettings, connectionId)
  const effectiveDiffSource: typeof file.diffSource =
    file.mode === 'edit' ? 'unstaged' : file.diffSource
  const compareAgainstHead = file.mode === 'edit'
  const workingTreeOldPath =
    effectiveDiffSource === 'staged' || effectiveDiffSource === 'unstaged'
      ? getWorkingTreeDiffOldPath({
          oldPath: file.branchOldPath,
          diffSource: effectiveDiffSource,
          diffStatus: file.diffStatus,
          compareAgainstHead
        })
      : file.branchOldPath
  const key = inFlightDiffKey(
    { ...file, diffSource: effectiveDiffSource },
    gitScope ?? undefined,
    compareAgainstHead,
    workingTreeOldPath
  )
  const handoffKey = `${key}::${diffHandoffStatusToken(file, effectiveDiffSource)}`
  if (options?.force) {
    inFlightDiffReads.delete(key)
    dropRetainedClickHandoff(handoffKey)
  }
  const inFlight = inFlightDiffReads.get(key)
  if (inFlight) {
    if (!options?.prefetch) {
      inFlight.consumedByRealRead = true
    } else if (options.prefetch === 'click-open') {
      // Why: a click joining a hover-started read makes the open imminent, so a
      // settle-before-mount result must reach the opening tab.
      inFlight.clickHandoff = true
      inFlight.handoffKey = handoffKey
    }
    return inFlight.promise
  }
  const retained = retainedClickHandoffDiffReads.get(handoffKey)
  if (retained) {
    if (!options?.prefetch) {
      // Why: one-shot — later non-prefetch reads (e.g. status reloads) must hit
      // the RPC again rather than reuse a warmed result.
      dropRetainedClickHandoff(handoffKey)
    }
    return retained.promise
  }
  const pending = (
    effectiveDiffSource === 'commit'
      ? commitCompare
        ? getRuntimeGitCommitDiff(
            {
              settings: fileSettings,
              worktreeId: file.worktreeId,
              worktreePath,
              connectionId
            },
            {
              commitOid: commitCompare.commitOid,
              parentOid: commitCompare.parentOid,
              filePath: file.relativePath,
              oldPath: file.branchOldPath
            }
          )
        : Promise.reject(new Error('Missing commit comparison for diff tab.'))
      : effectiveDiffSource === 'branch' && branchCompare
        ? getRuntimeGitBranchDiff(
            {
              settings: fileSettings,
              worktreeId: file.worktreeId,
              worktreePath,
              connectionId
            },
            {
              compare: {
                baseRef: branchCompare.baseRef,
                baseOid: branchCompare.baseOid!,
                headOid: branchCompare.headOid!,
                mergeBase: branchCompare.mergeBase!
              },
              filePath: file.relativePath,
              oldPath: file.branchOldPath
            }
          )
        : getRuntimeGitDiff(
            {
              settings: fileSettings,
              worktreeId: file.worktreeId,
              worktreePath,
              connectionId
            },
            {
              filePath: file.relativePath,
              oldPath: workingTreeOldPath,
              staged: effectiveDiffSource === 'staged',
              compareAgainstHead
            }
          )
  ) as Promise<DiffContent>
  const entry: InFlightDiffRead = {
    promise: pending,
    consumedByRealRead: !options?.prefetch,
    clickHandoff: options?.prefetch === 'click-open',
    handoffKey
  }
  inFlightDiffReads.set(key, entry)
  void pending.then(
    () => {
      if (inFlightDiffReads.get(key) !== entry) {
        return
      }
      inFlightDiffReads.delete(key)
      if (!entry.consumedByRealRead && entry.clickHandoff) {
        retainClickHandoff(entry.handoffKey, pending)
      }
    },
    () => {
      // Why: never retain failures — the next caller should retry the RPC.
      if (inFlightDiffReads.get(key) === entry) {
        inFlightDiffReads.delete(key)
      }
    }
  )
  return pending
}
