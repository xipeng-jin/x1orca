import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import { getRuntimeGitDiff } from '@/runtime/runtime-git-client'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { fetchEditorDiffContent, fetchEditorFileContent } from './editor-content-fetch'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: null }) }
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
