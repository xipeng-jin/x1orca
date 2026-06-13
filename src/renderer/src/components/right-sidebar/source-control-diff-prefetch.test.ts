import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusEntry } from '../../../../shared/types'
import type { OpenFile } from '@/store/slices/editor'
import { buildDiffEditorFileId } from '@/store/slices/editor'
import { getRuntimeGitDiff } from '@/runtime/runtime-git-client'
import type { DiffContent } from '@/components/editor/editor-panel-content-types'
import {
  fetchEditorDiffContent,
  resetEditorDiffClickHandoffForTests
} from '@/components/editor/editor-content-fetch'
import {
  buildSourceControlEntryDiffFetchInput,
  resetSourceControlDiffHoverPrefetchForTests,
  scheduleSourceControlDiffHoverPrefetch,
  startSourceControlDiffContentFetch
} from './source-control-diff-prefetch'

const mockOpenFiles: OpenFile[] = []
const mockGitStatusByWorktree: Record<string, GitStatusEntry[]> = {}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      settings: null,
      openFiles: mockOpenFiles,
      gitStatusByWorktree: mockGitStatusByWorktree
    })
  }
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionId: () => null
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  settingsForRuntimeOwner: (settings: unknown) => settings
}))
vi.mock('@/runtime/runtime-git-client', () => ({
  getRuntimeGitScope: () => undefined,
  getRuntimeGitDiff: vi.fn(),
  getRuntimeGitBranchDiff: vi.fn(),
  getRuntimeGitCommitDiff: vi.fn()
}))
vi.mock('@/runtime/runtime-file-client', () => ({
  getRuntimeFileReadScope: () => undefined,
  readRuntimeFileContent: vi.fn()
}))

const gitDiffMock = vi.mocked(getRuntimeGitDiff)

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function diffResult(modifiedContent: string): DiffContent {
  return {
    kind: 'text',
    originalContent: '',
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

function entry(overrides: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return {
    path: 'src/example.ts',
    status: 'modified',
    area: 'unstaged',
    ...overrides
  }
}

function target(
  overrides: Partial<GitStatusEntry> = {}
): Parameters<typeof buildSourceControlEntryDiffFetchInput>[0] {
  return { worktreeId: 'wt-1', worktreePath: '/repo', entry: entry(overrides) }
}

/** Mirror of the OpenFile the store's openDiff builds for the same row, to
 *  prove the prefetch input and the mount-effect input compute the same
 *  in-flight key even though they are constructed independently. */
function storeBuiltDiffTab(overrides: Partial<GitStatusEntry> = {}): OpenFile {
  const e = entry(overrides)
  const diffSource = e.area === 'staged' ? ('staged' as const) : ('unstaged' as const)
  return {
    id: buildDiffEditorFileId('wt-1', diffSource, e.path, undefined),
    filePath: `/repo/${e.path}`,
    relativePath: e.path,
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'diff',
    diffSource,
    diffStatus: e.status,
    branchOldPath: e.oldPath
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockOpenFiles.length = 0
  for (const key of Object.keys(mockGitStatusByWorktree)) {
    delete mockGitStatusByWorktree[key]
  }
  resetSourceControlDiffHoverPrefetchForTests()
  resetEditorDiffClickHandoffForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('buildSourceControlEntryDiffFetchInput', () => {
  it('returns null for conflict rows and unstaged markdown rows', () => {
    expect(
      buildSourceControlEntryDiffFetchInput(
        target({ conflictKind: 'both_modified', conflictStatus: 'unresolved' })
      )
    ).toBeNull()
    expect(
      buildSourceControlEntryDiffFetchInput(target({ path: 'docs/readme.md', area: 'unstaged' }))
    ).toBeNull()
  })

  it('builds diff inputs for staged markdown and untracked rows', () => {
    expect(
      buildSourceControlEntryDiffFetchInput(target({ path: 'docs/readme.md', area: 'staged' }))
    ).toMatchObject({ mode: 'diff', diffSource: 'staged', relativePath: 'docs/readme.md' })
    expect(buildSourceControlEntryDiffFetchInput(target({ area: 'untracked' }))).toMatchObject({
      mode: 'diff',
      diffSource: 'unstaged'
    })
  })

  it('mirrors the working-tree oldPath policy of the click path', () => {
    const renamed = buildSourceControlEntryDiffFetchInput(
      target({ oldPath: 'src/old.ts', status: 'renamed', area: 'staged' })
    )
    expect(renamed?.branchOldPath).toBe('src/old.ts')
    // Unstaged edit companion of a staged rename must not diff against oldPath.
    const companion = buildSourceControlEntryDiffFetchInput(
      target({ oldPath: 'src/old.ts', status: 'modified', area: 'unstaged' })
    )
    expect(companion?.branchOldPath).toBeUndefined()
  })
})

describe('startSourceControlDiffContentFetch', () => {
  it('warms the in-flight read so the mount-effect fetch coalesces into one RPC', async () => {
    const rpc = deferred<DiffContent>()
    gitDiffMock.mockReturnValueOnce(rpc.promise)
    const clickInput = buildSourceControlEntryDiffFetchInput(target({ path: 'src/click.ts' }))!

    startSourceControlDiffContentFetch(clickInput)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    // The mount effect fetches with the store-built OpenFile, not our object.
    const mountFetch = fetchEditorDiffContent(storeBuiltDiffTab({ path: 'src/click.ts' }))
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    const result = diffResult('one')
    rpc.resolve(result)
    await expect(mountFetch).resolves.toBe(result)
  })

  it('swallows RPC failures instead of surfacing unhandled rejections', async () => {
    gitDiffMock.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    startSourceControlDiffContentFetch(
      buildSourceControlEntryDiffFetchInput(target({ path: 'src/fails.ts' }))!
    )
    // Drain the rejection; an unhandled rejection would fail the test run.
    await vi.advanceTimersByTimeAsync(0)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('skips fetching when the diff tab is already open (reopen force-refetches)', () => {
    const clickInput = buildSourceControlEntryDiffFetchInput(target({ path: 'src/open.ts' }))!
    mockOpenFiles.push(storeBuiltDiffTab({ path: 'src/open.ts' }))

    startSourceControlDiffContentFetch(clickInput)
    expect(gitDiffMock).not.toHaveBeenCalled()
  })
})

describe('scheduleSourceControlDiffHoverPrefetch', () => {
  it('debounces: no RPC before the delay, one after', () => {
    gitDiffMock.mockReturnValueOnce(deferred<DiffContent>().promise)
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/hover.ts' }))

    vi.advanceTimersByTime(99)
    expect(gitDiffMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('cancelling before the debounce fires issues no RPC', () => {
    const handle = scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/leave.ts' }))
    handle!.cancel()
    vi.advanceTimersByTime(1000)
    expect(gitDiffMock).not.toHaveBeenCalled()
  })

  it('returns null for rows that do not route to a diff tab', () => {
    expect(
      scheduleSourceControlDiffHoverPrefetch(target({ path: 'docs/readme.md', area: 'unstaged' }))
    ).toBeNull()
    expect(
      scheduleSourceControlDiffHoverPrefetch(
        target({ conflictKind: 'both_modified', conflictStatus: 'unresolved' })
      )
    ).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(gitDiffMock).not.toHaveBeenCalled()
  })

  it('caps concurrent hover prefetches and frees slots when RPCs settle', async () => {
    const first = deferred<DiffContent>()
    const second = deferred<DiffContent>()
    gitDiffMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(deferred<DiffContent>().promise)

    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/a.ts' }))
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/b.ts' }))
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/c.ts' }))
    vi.advanceTimersByTime(100)
    expect(gitDiffMock).toHaveBeenCalledTimes(2)

    first.resolve(diffResult('a'))
    second.resolve(diffResult('b'))
    await vi.advanceTimersByTimeAsync(0)

    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/c.ts' }))
    vi.advanceTimersByTime(100)
    expect(gitDiffMock).toHaveBeenCalledTimes(3)
  })

  it('does not double-fetch when the same row is hovered repeatedly mid-flight', () => {
    gitDiffMock.mockReturnValue(deferred<DiffContent>().promise)
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/again.ts' }))
    vi.advanceTimersByTime(100)
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/again.ts' }))
    vi.advanceTimersByTime(100)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('skips rows whose diff tab is already open', () => {
    mockOpenFiles.push(storeBuiltDiffTab({ path: 'src/already.ts' }))
    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/already.ts' }))
    vi.advanceTimersByTime(100)
    expect(gitDiffMock).not.toHaveBeenCalled()
  })

  it('hover-then-click-then-mount all share a single RPC', async () => {
    const rpc = deferred<DiffContent>()
    gitDiffMock.mockReturnValueOnce(rpc.promise)

    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/full-path.ts' }))
    vi.advanceTimersByTime(100)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    startSourceControlDiffContentFetch(
      buildSourceControlEntryDiffFetchInput(target({ path: 'src/full-path.ts' }))!
    )
    const mountFetch = fetchEditorDiffContent(storeBuiltDiffTab({ path: 'src/full-path.ts' }))
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    const result = diffResult('warm')
    rpc.resolve(result)
    await expect(mountFetch).resolves.toBe(result)
  })

  it('hands a click RPC that settled before the mount to the mount effect — one RPC', async () => {
    const result = diffResult('warm')
    gitDiffMock.mockReturnValueOnce(Promise.resolve(result))

    startSourceControlDiffContentFetch(
      buildSourceControlEntryDiffFetchInput(target({ path: 'src/fast-click.ts' }))!
    )
    // The click RPC settles while React is still rendering / loading lazy chunks.
    await vi.advanceTimersByTimeAsync(0)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    // The mount-effect read consumes the settled handoff (status unchanged) —
    // no second RPC, so the open costs exactly one git.diff call.
    const mountFetch = fetchEditorDiffContent(storeBuiltDiffTab({ path: 'src/fast-click.ts' }))
    await expect(mountFetch).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when the file git status changes between the click and the mount', async () => {
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(diffResult('warm')))
      .mockReturnValueOnce(Promise.resolve(diffResult('fresh')))
    mockGitStatusByWorktree['wt-1'] = [
      { path: 'src/restatus.ts', area: 'unstaged', status: 'modified' }
    ]

    startSourceControlDiffContentFetch(
      buildSourceControlEntryDiffFetchInput(target({ path: 'src/restatus.ts' }))!
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    // The worktree changes before the mount, so the handoff key no longer
    // matches and the mount-effect read issues a fresh RPC.
    mockGitStatusByWorktree['wt-1'] = [
      { path: 'src/restatus.ts', area: 'unstaged', status: 'deleted' }
    ]
    const mountFetch = fetchEditorDiffContent(storeBuiltDiffTab({ path: 'src/restatus.ts' }))
    await expect(mountFetch).resolves.toEqual(diffResult('fresh'))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('refetches after a settled hover, and the mount joins the still-in-flight click read', async () => {
    const fresh = deferred<DiffContent>()
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(diffResult('speculative')))
      .mockReturnValueOnce(fresh.promise)

    scheduleSourceControlDiffHoverPrefetch(target({ path: 'src/fast-hover.ts' }))
    await vi.advanceTimersByTimeAsync(100)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    // The hover already settled (nothing retained), so the click issues a fresh
    // RPC; the mount effect joins that still-in-flight read — no third RPC.
    startSourceControlDiffContentFetch(
      buildSourceControlEntryDiffFetchInput(target({ path: 'src/fast-hover.ts' }))!
    )
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
    const mountFetch = fetchEditorDiffContent(storeBuiltDiffTab({ path: 'src/fast-hover.ts' }))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
    fresh.resolve(diffResult('fresh'))
    await expect(mountFetch).resolves.toEqual(diffResult('fresh'))
  })
})
