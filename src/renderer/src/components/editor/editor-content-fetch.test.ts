import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import { getRuntimeGitDiff } from '@/runtime/runtime-git-client'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import {
  fetchEditorDiffContent,
  fetchEditorFileContent,
  resetEditorDiffClickHandoffForTests
} from './editor-content-fetch'

// Why: the handoff key embeds this per-file status signature; tests mutate it to
// prove a worktree change between a settled click and the mount invalidates it.
const mockGitStatusByWorktree: Record<
  string,
  { path: string; area: string; status: string; conflictStatus?: string }[]
> = {}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ settings: null, gitStatusByWorktree: mockGitStatusByWorktree })
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
const readFileMock = vi.mocked(readRuntimeFileContent)

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

// Why: a macrotask hop proves entries outlive the old queueMicrotask-scoped
// lifetime — overlapping RPC callers arrive across tasks, not within one.
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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

function diffTab(relativePath: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: `tab:${relativePath}`,
    filePath: `/repo/${relativePath}`,
    relativePath,
    mode: 'diff',
    diffSource: 'unstaged',
    worktreeId: 'wt-1',
    ...overrides
  } as OpenFile
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(mockGitStatusByWorktree)) {
    delete mockGitStatusByWorktree[key]
  }
})

afterEach(() => {
  resetEditorDiffClickHandoffForTests()
})

describe('fetchEditorDiffContent', () => {
  it('coalesces overlapping reads of the same diff into one RPC', async () => {
    const rpc = deferred<DiffContent>()
    gitDiffMock.mockReturnValueOnce(rpc.promise)
    const file = diffTab('src/coalesce.ts')

    const first = fetchEditorDiffContent(file)
    await nextMacrotask()
    const second = fetchEditorDiffContent(file)

    const result = diffResult('one')
    rpc.resolve(result)
    await expect(first).resolves.toBe(result)
    await expect(second).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('force bypasses a still-in-flight entry and the old settlement does not evict the replacement', async () => {
    const firstRpc = deferred<DiffContent>()
    const secondRpc = deferred<DiffContent>()
    gitDiffMock.mockReturnValueOnce(firstRpc.promise).mockReturnValueOnce(secondRpc.promise)
    const file = diffTab('src/force.ts')

    const first = fetchEditorDiffContent(file)
    await nextMacrotask()
    const forced = fetchEditorDiffContent(file, { force: true })
    expect(gitDiffMock).toHaveBeenCalledTimes(2)

    const firstResult = diffResult('stale')
    firstRpc.resolve(firstResult)
    await expect(first).resolves.toBe(firstResult)

    // The forced entry must survive the first promise's settlement cleanup.
    const joined = fetchEditorDiffContent(file)
    expect(gitDiffMock).toHaveBeenCalledTimes(2)

    const secondResult = diffResult('fresh')
    secondRpc.resolve(secondResult)
    await expect(forced).resolves.toBe(secondResult)
    await expect(joined).resolves.toBe(secondResult)
  })

  it('issues a fresh RPC after the previous read resolved', async () => {
    const firstResult = diffResult('a')
    const secondResult = diffResult('b')
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(firstResult))
      .mockReturnValueOnce(Promise.resolve(secondResult))
    const file = diffTab('src/settled.ts')

    await expect(fetchEditorDiffContent(file)).resolves.toBe(firstResult)
    await expect(fetchEditorDiffContent(file)).resolves.toBe(secondResult)
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('issues a fresh RPC after the previous read rejected', async () => {
    const result = diffResult('recovered')
    gitDiffMock
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockReturnValueOnce(Promise.resolve(result))
    const file = diffTab('src/rejected.ts')

    await expect(fetchEditorDiffContent(file)).rejects.toThrow('boom')
    await expect(fetchEditorDiffContent(file)).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('hands a settled click-open result to the next real read (one-shot)', async () => {
    const result = diffResult('warm')
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(result))
      .mockReturnValueOnce(Promise.resolve(diffResult('fresh')))
    const file = diffTab('src/retained.ts')

    // The click-open RPC settles before the tab's mount effect arrives.
    await expect(fetchEditorDiffContent(file, { prefetch: 'click-open' })).resolves.toBe(result)

    // The late mount-effect read consumes the handoff — no second RPC.
    await expect(fetchEditorDiffContent(file)).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)

    // Consumption is one-shot: the next read goes back to the RPC.
    await expect(fetchEditorDiffContent(file)).resolves.toEqual(diffResult('fresh'))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('never retains settled hover reads — hover only shares in-flight RPCs', async () => {
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(diffResult('speculative')))
      .mockReturnValueOnce(Promise.resolve(diffResult('fresh')))
    const file = diffTab('src/hover-settled.ts')

    await expect(fetchEditorDiffContent(file, { prefetch: 'hover' })).resolves.toEqual(
      diffResult('speculative')
    )

    // The file may have changed since the hover; a real read must refetch.
    await expect(fetchEditorDiffContent(file)).resolves.toEqual(diffResult('fresh'))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('upgrades a hover-started read to a handoff when a click-open joins it', async () => {
    const rpc = deferred<DiffContent>()
    gitDiffMock.mockReturnValueOnce(rpc.promise)
    const file = diffTab('src/hover-upgraded.ts')

    void fetchEditorDiffContent(file, { prefetch: 'hover' })
    void fetchEditorDiffContent(file, { prefetch: 'click-open' })
    const result = diffResult('warm')
    rpc.resolve(result)
    await rpc.promise

    // The click made the open imminent, so the settled result reaches the
    // mount-effect read without a second RPC.
    await expect(fetchEditorDiffContent(file)).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(1)
  })

  it('does not retain a click-open result a real caller already joined in flight', async () => {
    const rpc = deferred<DiffContent>()
    gitDiffMock
      .mockReturnValueOnce(rpc.promise)
      .mockReturnValueOnce(Promise.resolve(diffResult('fresh')))
    const file = diffTab('src/joined.ts')

    void fetchEditorDiffContent(file, { prefetch: 'click-open' })
    const joined = fetchEditorDiffContent(file)
    const result = diffResult('warm')
    rpc.resolve(result)
    await expect(joined).resolves.toBe(result)

    // The join already delivered the result to the store-writing caller, so
    // nothing is retained and the next read issues a fresh RPC.
    await expect(fetchEditorDiffContent(file)).resolves.toEqual(diffResult('fresh'))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('force bypasses and drops a click-open handoff', async () => {
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(diffResult('stale')))
      .mockReturnValueOnce(Promise.resolve(diffResult('forced')))
      .mockReturnValueOnce(Promise.resolve(diffResult('after')))
    const file = diffTab('src/force-retained.ts')

    await expect(fetchEditorDiffContent(file, { prefetch: 'click-open' })).resolves.toEqual(
      diffResult('stale')
    )
    await expect(fetchEditorDiffContent(file, { force: true })).resolves.toEqual(
      diffResult('forced')
    )
    await expect(fetchEditorDiffContent(file)).resolves.toEqual(diffResult('after'))
    expect(gitDiffMock).toHaveBeenCalledTimes(3)
  })

  it('does not retain rejected click-open reads', async () => {
    const result = diffResult('recovered')
    gitDiffMock
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockReturnValueOnce(Promise.resolve(result))
    const file = diffTab('src/prefetch-rejected.ts')

    await expect(fetchEditorDiffContent(file, { prefetch: 'click-open' })).rejects.toThrow('boom')
    await expect(fetchEditorDiffContent(file)).resolves.toBe(result)
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('invalidates a click-open handoff when the file git status changes', async () => {
    gitDiffMock
      .mockReturnValueOnce(Promise.resolve(diffResult('warm')))
      .mockReturnValueOnce(Promise.resolve(diffResult('fresh')))
    const file = diffTab('src/changed.ts')
    mockGitStatusByWorktree['wt-1'] = [
      { path: 'src/changed.ts', area: 'unstaged', status: 'modified' }
    ]

    // Click-open settles and is retained under the current status signature.
    await expect(fetchEditorDiffContent(file, { prefetch: 'click-open' })).resolves.toEqual(
      diffResult('warm')
    )

    // The worktree changes before the mount, so the handoff key no longer
    // matches and the mount-effect read refetches instead of serving the stale result.
    mockGitStatusByWorktree['wt-1'] = [
      { path: 'src/changed.ts', area: 'unstaged', status: 'deleted' }
    ]
    await expect(fetchEditorDiffContent(file)).resolves.toEqual(diffResult('fresh'))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce reads with different dedupe keys', async () => {
    gitDiffMock
      .mockReturnValueOnce(deferred<DiffContent>().promise)
      .mockReturnValueOnce(deferred<DiffContent>().promise)

    void fetchEditorDiffContent(diffTab('src/keys.ts'))
    await nextMacrotask()
    void fetchEditorDiffContent(diffTab('src/keys.ts', { diffSource: 'staged' }))
    expect(gitDiffMock).toHaveBeenCalledTimes(2)
  })
})

describe('fetchEditorFileContent', () => {
  it('coalesces overlapping reads of the same file into one RPC', async () => {
    const rpc = deferred<FileContent>()
    readFileMock.mockReturnValueOnce(rpc.promise)
    const args = { settings: null, filePath: '/repo/src/coalesce.ts' }

    const first = fetchEditorFileContent(args)
    await nextMacrotask()
    const second = fetchEditorFileContent(args)

    const result: FileContent = { content: 'one', isBinary: false }
    rpc.resolve(result)
    await expect(first).resolves.toBe(result)
    await expect(second).resolves.toBe(result)
    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it('force bypasses a still-in-flight entry and the old settlement does not evict the replacement', async () => {
    const firstRpc = deferred<FileContent>()
    const secondRpc = deferred<FileContent>()
    readFileMock.mockReturnValueOnce(firstRpc.promise).mockReturnValueOnce(secondRpc.promise)
    const args = { settings: null, filePath: '/repo/src/force.ts' }

    const first = fetchEditorFileContent(args)
    await nextMacrotask()
    const forced = fetchEditorFileContent(args, { force: true })
    expect(readFileMock).toHaveBeenCalledTimes(2)

    const staleResult: FileContent = { content: 'stale', isBinary: false }
    firstRpc.resolve(staleResult)
    await expect(first).resolves.toBe(staleResult)

    // The forced entry must survive the first promise's settlement cleanup.
    const joined = fetchEditorFileContent(args)
    expect(readFileMock).toHaveBeenCalledTimes(2)

    const freshResult: FileContent = { content: 'fresh', isBinary: false }
    secondRpc.resolve(freshResult)
    await expect(forced).resolves.toBe(freshResult)
    await expect(joined).resolves.toBe(freshResult)
  })

  it('issues a fresh RPC after the previous read settled', async () => {
    const firstResult: FileContent = { content: 'a', isBinary: false }
    readFileMock
      .mockReturnValueOnce(Promise.resolve(firstResult))
      .mockImplementationOnce(() => Promise.reject(new Error('gone')))
    const args = { settings: null, filePath: '/repo/src/settled.ts' }

    await expect(fetchEditorFileContent(args)).resolves.toBe(firstResult)
    await expect(fetchEditorFileContent(args)).rejects.toThrow('gone')
    expect(readFileMock).toHaveBeenCalledTimes(2)
  })
})
