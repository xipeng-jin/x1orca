// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffContent } from './editor-panel-content-types'

// Capture every diff fetch with a hand-held resolver so the test controls when
// (and with what content) a forced refetch settles — proving the reload swaps
// content without first blanking the tab.
type DiffFetchCall = {
  id: string
  force: boolean | undefined
  resolve: (value: DiffContent) => void
}
const diffFetch = vi.hoisted(() => ({ calls: [] as DiffFetchCall[] }))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: { settings: null }) => unknown) => selector({ settings: null }),
    { getState: () => ({ settings: null, gitStatusByWorktree: {} }) }
  )
}))

vi.mock('./editor-content-fetch', () => ({
  fetchEditorDiffContent: (file: OpenFile, options?: { force?: boolean }) =>
    new Promise<DiffContent>((resolve) => {
      diffFetch.calls.push({ id: file.id, force: options?.force, resolve })
    }),
  // File reads never resolve here — these tests only exercise the diff path.
  fetchEditorFileContent: () => new Promise<never>(() => {})
}))

import { useEditorPanelContentState } from './useEditorPanelContentState'

// Stable empties so re-renders don't churn the lazy-load effect's deps.
const EMPTY_GIT_STATUS = {}
const EMPTY_VIEW_MODE = {}

let latestDiffContents: Record<string, DiffContent> = {}

function HookProbe({
  activeFile,
  openFiles
}: {
  activeFile: OpenFile | null
  openFiles: OpenFile[]
}): null {
  const { diffContents } = useEditorPanelContentState({
    activeFile,
    isChangesMode: false,
    openFiles,
    gitStatusByWorktree: EMPTY_GIT_STATUS,
    editorViewMode: EMPTY_VIEW_MODE
  })
  latestDiffContents = diffContents
  return null
}

function makeDiffFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: 'wt-1::diff::unstaged::file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'diff',
    diffSource: 'unstaged',
    ...overrides
  }
}

function textDiff(modifiedContent: string): DiffContent {
  return {
    kind: 'text',
    originalContent: 'original\n',
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(element: React.ReactElement): void {
  if (!root) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => {
    root?.render(element)
  })
}

beforeEach(() => {
  diffFetch.calls = []
  latestDiffContents = {}
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = undefined
  container = undefined
})

describe('useEditorPanelContentState reload-nonce diff behavior', () => {
  it('keeps stale diff content visible during a forced nonce reload and swaps on arrival', async () => {
    const file = makeDiffFile()
    render(<HookProbe activeFile={file} openFiles={[file]} />)

    // First open issues a non-forced fetch.
    expect(diffFetch.calls).toHaveLength(1)
    expect(diffFetch.calls[0]).toMatchObject({ id: file.id, force: undefined })

    await act(async () => {
      diffFetch.calls[0].resolve(textDiff('old\n'))
    })
    expect(latestDiffContents[file.id]).toMatchObject({ modifiedContent: 'old\n' })

    // Re-clicking the open tab bumps the reload nonce.
    const reopened = makeDiffFile({ diffContentReloadNonce: 1 })
    render(<HookProbe activeFile={reopened} openFiles={[reopened]} />)

    // The forced refetch is issued, and the previous content stays present —
    // there is no transient delete that would blank the tab to "Loading…".
    const forced = diffFetch.calls.find((call) => call.force === true)
    if (!forced) {
      throw new Error('expected a forced refetch on the nonce bump')
    }
    expect(latestDiffContents[file.id]).toMatchObject({ modifiedContent: 'old\n' })

    // A real content change still swaps through once the refetch resolves.
    await act(async () => {
      forced.resolve(textDiff('new\n'))
    })
    expect(latestDiffContents[file.id]).toMatchObject({ modifiedContent: 'new\n' })
  })

  it('keeps the newest forced reload content when overlapping reloads resolve out of order', async () => {
    const file = makeDiffFile()
    render(<HookProbe activeFile={file} openFiles={[file]} />)
    await act(async () => {
      diffFetch.calls[0].resolve(textDiff('old\n'))
    })

    // Two forced reloads overlap in flight: nonce 1 (older), then nonce 2 (newer).
    const reopenedOnce = makeDiffFile({ diffContentReloadNonce: 1 })
    render(<HookProbe activeFile={reopenedOnce} openFiles={[reopenedOnce]} />)
    const reopenedTwice = makeDiffFile({ diffContentReloadNonce: 2 })
    render(<HookProbe activeFile={reopenedTwice} openFiles={[reopenedTwice]} />)

    const forced = diffFetch.calls.filter((call) => call.force === true)
    expect(forced).toHaveLength(2)

    // The newer reload resolves first and swaps in fresh content.
    await act(async () => {
      forced[1].resolve(textDiff('newest\n'))
    })
    expect(latestDiffContents[file.id]).toMatchObject({ modifiedContent: 'newest\n' })

    // The older reload resolves later and must NOT overwrite the newer content.
    await act(async () => {
      forced[0].resolve(textDiff('stale\n'))
    })
    expect(latestDiffContents[file.id]).toMatchObject({ modifiedContent: 'newest\n' })
  })

  it('skips the forced reload while the first-open fetch is pending so it never duplicates the RPC', () => {
    const file = makeDiffFile()
    render(<HookProbe activeFile={file} openFiles={[file]} />)

    // First-open fetch is still pending (unresolved), so no content yet.
    expect(diffFetch.calls).toHaveLength(1)
    expect(latestDiffContents[file.id]).toBeUndefined()

    const reopened = makeDiffFile({ diffContentReloadNonce: 1 })
    render(<HookProbe activeFile={reopened} openFiles={[reopened]} />)

    // The in-flight first-open fetch will populate the tab; the nonce effect
    // skips (it does not re-run on content arrival), so no forced refetch is
    // issued and the git-diff RPC is never duplicated.
    expect(diffFetch.calls.some((call) => call.force === true)).toBe(false)
  })
})
