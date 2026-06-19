// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../../shared/types'
import { usePierreDiffCommentAnnotations } from './usePierreDiffCommentAnnotations'

const mockState = vi.hoisted(() => ({
  store: {
    activeGroupIdByWorktree: {} as Record<string, string>,
    worktreesByRepo: {} as Record<string, { id: string; diffComments?: DiffComment[] }[]>,
    addDiffComment: vi.fn(),
    updateDiffComment: vi.fn(),
    deleteDiffComment: vi.fn(),
    scrollToDiffCommentId: null as string | null,
    scrollToDiffCommentRequestSeq: 0,
    setScrollToDiffCommentId: vi.fn(),
    pierreDiffCommentExpandedIdsByScope: {} as Record<string, ReadonlySet<string>>,
    updatePierreDiffCommentExpandedIds: vi.fn(
      (scopeKey: string, updater: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
        const current = mockState.store.pierreDiffCommentExpandedIdsByScope[scopeKey] ?? new Set()
        const next = updater(current)
        if (next.size === 0) {
          delete mockState.store.pierreDiffCommentExpandedIdsByScope[scopeKey]
        } else {
          mockState.store.pierreDiffCommentExpandedIdsByScope[scopeKey] = new Set(next)
        }
      }
    )
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mockState.store) => unknown) => selector(mockState.store)
}))

vi.mock('@/components/editor/DiffNotesSendMenu', () => ({
  DiffNotesSendMenu: () => null
}))

const ITEM_ID = 'orca-single-file-diff'

function makeComment(id: string, lineNumber: number): DiffComment {
  return {
    id,
    worktreeId: 'repo',
    filePath: 'src/app.ts',
    source: 'diff',
    lineNumber,
    body: 'note',
    createdAt: 1,
    side: 'modified'
  }
}

function TestHarness({
  enabled,
  fileDiff,
  codeViewRef
}: {
  enabled: boolean
  fileDiff: FileDiffMetadata
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>
}): null {
  usePierreDiffCommentAnnotations({
    enabled,
    worktreeId: 'repo',
    relativePath: 'src/app.ts',
    fileDiff,
    codeViewRef,
    itemId: ITEM_ID
  })
  return null
}

async function renderHookHarness(
  root: Root,
  args: React.ComponentProps<typeof TestHarness>
): Promise<void> {
  await act(async () => {
    root.render(<TestHarness {...args} />)
  })
}

async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('usePierreDiffCommentAnnotations', () => {
  beforeEach(() => {
    mockState.store.activeGroupIdByWorktree = {}
    mockState.store.worktreesByRepo = {}
    mockState.store.addDiffComment.mockReset()
    mockState.store.updateDiffComment.mockReset()
    mockState.store.deleteDiffComment.mockReset()
    mockState.store.scrollToDiffCommentId = null
    mockState.store.scrollToDiffCommentRequestSeq = 0
    mockState.store.setScrollToDiffCommentId.mockReset()
    mockState.store.pierreDiffCommentExpandedIdsByScope = {}
    mockState.store.updatePierreDiffCommentExpandedIds.mockClear()
  })

  it('scrolls to and acknowledges a matching comment even when inline affordances are disabled', async () => {
    const scrollTo = vi.fn()
    const codeViewRef = {
      current: {
        scrollTo,
        getInstance: () => ({
          getRenderedItems: () => [
            {
              id: ITEM_ID,
              type: 'diff',
              instance: {
                getLinePosition: () => ({ top: 40, height: 20 }),
                expandHunk: vi.fn()
              },
              element: document.createElement('div')
            }
          ]
        })
      } as unknown as CodeViewHandle<DiffComment>
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 4)] }]
    }
    mockState.store.scrollToDiffCommentId = 'c1'
    const root = createRoot(document.createElement('div'))

    await renderHookHarness(root, {
      enabled: false,
      fileDiff: { hunks: [] } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await nextFrame()

    expect(scrollTo).toHaveBeenCalledWith({
      type: 'line',
      id: ITEM_ID,
      lineNumber: 4,
      side: 'additions',
      align: 'center'
    })
    expect(mockState.store.setScrollToDiffCommentId).toHaveBeenCalledWith(null)
    expect(mockState.store.pierreDiffCommentExpandedIdsByScope['repo\u001fsrc/app.ts']).toEqual(
      new Set(['c1'])
    )
    root.unmount()
  })

  it('scrolls again when the same comment id is requested with a new sequence', async () => {
    const scrollTo = vi.fn()
    const codeViewRef = {
      current: {
        scrollTo,
        getInstance: () => ({
          getRenderedItems: () => [
            {
              id: ITEM_ID,
              type: 'diff',
              instance: {
                getLinePosition: () => ({ top: 40, height: 20 }),
                expandHunk: vi.fn()
              },
              element: document.createElement('div')
            }
          ]
        })
      } as unknown as CodeViewHandle<DiffComment>
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 4)] }]
    }
    mockState.store.scrollToDiffCommentId = 'c1'
    mockState.store.scrollToDiffCommentRequestSeq = 1
    const root = createRoot(document.createElement('div'))

    await renderHookHarness(root, {
      enabled: true,
      fileDiff: { hunks: [] } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await nextFrame()
    expect(scrollTo).toHaveBeenCalledTimes(1)

    mockState.store.scrollToDiffCommentId = 'c1'
    mockState.store.scrollToDiffCommentRequestSeq = 2
    await renderHookHarness(root, {
      enabled: true,
      fileDiff: { hunks: [] } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await nextFrame()

    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(mockState.store.setScrollToDiffCommentId).toHaveBeenCalledWith(null)
    root.unmount()
  })

  it('retries scrolling after expanding a collapsed context region', async () => {
    let visible = false
    const scrollTo = vi.fn()
    const expandHunk = vi.fn(() => {
      visible = true
    })
    const codeViewRef = {
      current: {
        scrollTo,
        getInstance: () => ({
          getRenderedItems: () => [
            {
              id: ITEM_ID,
              type: 'diff',
              instance: {
                getLinePosition: () => (visible ? { top: 40, height: 20 } : undefined),
                expandHunk
              },
              element: document.createElement('div')
            }
          ]
        })
      } as unknown as CodeViewHandle<DiffComment>
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 20)] }]
    }
    mockState.store.scrollToDiffCommentId = 'c1'
    const root = createRoot(document.createElement('div'))

    await renderHookHarness(root, {
      enabled: true,
      fileDiff: {
        isPartial: false,
        hunks: [{ collapsedBefore: 20, additionStart: 30 }]
      } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await nextFrame()
    await nextFrame()

    expect(expandHunk).toHaveBeenCalledWith(0, 'down', 10)
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'line', lineNumber: 20, side: 'additions' })
    )
    expect(mockState.store.setScrollToDiffCommentId).toHaveBeenCalledWith(null)
    expect(mockState.store.pierreDiffCommentExpandedIdsByScope['repo\u001fsrc/app.ts']).toEqual(
      new Set(['c1'])
    )
    root.unmount()
  })

  it('retries a collapsed-region scroll until a freshly mounted CodeView renders the item', async () => {
    const scrollTo = vi.fn()
    const expandHunk = vi.fn()
    let visible = false
    let renderCalls = 0
    const codeViewRef = {
      current: {
        scrollTo,
        getInstance: () => ({
          // Why: the first frames return no rendered items, mimicking a fresh
          // mount after navigating back to an inactive diff tab. The old code
          // gave up on the first failed expand; the new code must keep retrying.
          getRenderedItems: () => {
            renderCalls += 1
            if (renderCalls < 3) {
              return []
            }
            return [
              {
                id: ITEM_ID,
                type: 'diff',
                instance: {
                  getLinePosition: () => (visible ? { top: 40, height: 20 } : undefined),
                  expandHunk: () => {
                    visible = true
                    expandHunk()
                  }
                },
                element: document.createElement('div')
              }
            ]
          }
        })
      } as unknown as CodeViewHandle<DiffComment>
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 20)] }]
    }
    mockState.store.scrollToDiffCommentId = 'c1'
    const root = createRoot(document.createElement('div'))

    await renderHookHarness(root, {
      enabled: true,
      fileDiff: {
        isPartial: false,
        hunks: [{ collapsedBefore: 20, additionStart: 30 }]
      } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await nextFrame()
    await nextFrame()
    await nextFrame()
    await nextFrame()

    expect(expandHunk).toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'line', lineNumber: 20, side: 'additions' })
    )
    root.unmount()
  })

  it('reports pendingScrollToComment only when the request targets a comment in this file', async () => {
    const codeViewRef = {
      current: null
    } as React.MutableRefObject<CodeViewHandle<DiffComment> | null>
    let pending = false
    function Capture(): null {
      pending = usePierreDiffCommentAnnotations({
        enabled: true,
        worktreeId: 'repo',
        relativePath: 'src/app.ts',
        fileDiff: { hunks: [] } as unknown as FileDiffMetadata,
        codeViewRef,
        itemId: ITEM_ID
      }).pendingScrollToComment
      return null
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 4)] }]
    }
    const root = createRoot(document.createElement('div'))

    mockState.store.scrollToDiffCommentId = null
    await act(async () => {
      root.render(<Capture />)
    })
    expect(pending).toBe(false)

    mockState.store.scrollToDiffCommentId = 'c1'
    await act(async () => {
      root.render(<Capture />)
    })
    expect(pending).toBe(true)

    mockState.store.scrollToDiffCommentId = 'comment-on-another-file'
    await act(async () => {
      root.render(<Capture />)
    })
    expect(pending).toBe(false)

    root.unmount()
  })

  it('clears a matching scroll request when the viewer unmounts before polling resolves', async () => {
    const codeViewRef = {
      current: {
        scrollTo: vi.fn(),
        getInstance: () => ({
          getRenderedItems: () => [
            {
              id: ITEM_ID,
              type: 'diff',
              instance: {
                getLinePosition: () => undefined,
                expandHunk: vi.fn()
              },
              element: document.createElement('div')
            }
          ]
        })
      } as unknown as CodeViewHandle<DiffComment>
    }
    mockState.store.worktreesByRepo = {
      repo: [{ id: 'repo', diffComments: [makeComment('c1', 4)] }]
    }
    mockState.store.scrollToDiffCommentId = 'c1'
    const root = createRoot(document.createElement('div'))

    await renderHookHarness(root, {
      enabled: true,
      fileDiff: { hunks: [] } as unknown as FileDiffMetadata,
      codeViewRef
    })
    await act(async () => {
      root.unmount()
    })

    expect(mockState.store.setScrollToDiffCommentId).toHaveBeenCalledWith(null)
  })
})
