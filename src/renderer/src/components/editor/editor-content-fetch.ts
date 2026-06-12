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
// prefetch — can start a fetch that coalesces with the mount-effect fetch.
const inFlightFileReads = new Map<string, Promise<FileContent>>()
const inFlightDiffReads = new Map<string, Promise<DiffContent>>()

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
  options?: { force?: boolean }
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
  if (options?.force) {
    inFlightDiffReads.delete(key)
  }
  let pending = inFlightDiffReads.get(key)
  if (!pending) {
    pending = (
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
    inFlightDiffReads.set(key, pending)
    deleteInFlightEntryOnSettle(inFlightDiffReads, key, pending)
  }
  return pending
}
