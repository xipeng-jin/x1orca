// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CodeViewItem } from '@pierre/diffs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../../shared/types'

const mockState = vi.hoisted(() => ({
  codeViewProps: [] as { items: CodeViewItem<DiffComment>[] }[],
  codeViewHandle: null as unknown,
  store: {
    settings: {
      theme: 'dark'
    },
    editorFontZoomLevel: 0,
    activeGroupIdByWorktree: {} as Record<string, string>,
    worktreesByRepo: {} as Record<string, { id: string; diffComments?: DiffComment[] }[]>,
    addDiffComment: vi.fn(),
    updateDiffComment: vi.fn(),
    deleteDiffComment: vi.fn(),
    scrollToDiffCommentId: null as string | null,
    scrollToDiffCommentRequestSeq: 0,
    setScrollToDiffCommentId: vi.fn(),
    pierreDiffCommentExpandedIdsByScope: {} as Record<string, ReadonlySet<string>>,
    updatePierreDiffCommentExpandedIds: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mockState.store) => unknown) => selector(mockState.store)
}))

vi.mock('@pierre/diffs/react', async () => {
  const ReactModule = await import('react')
  return {
    CodeView: ReactModule.forwardRef((props: unknown, ref) => {
      mockState.codeViewProps.push(props as { items: CodeViewItem<DiffComment>[] })
      ReactModule.useImperativeHandle(ref, () => mockState.codeViewHandle)
      return ReactModule.createElement('div', { 'data-testid': 'pierre-code-view' })
    })
  }
})

import DiffViewer from './DiffViewer'

function getOnlyCodeViewItemVersion(): number | undefined {
  expect(mockState.codeViewProps).toHaveLength(1)
  const item = mockState.codeViewProps[0]?.items[0]
  if (item?.type !== 'diff') {
    throw new Error('Expected a CodeView diff item')
  }
  return item.version
}

function renderDiffWithRoot(root: Root | null, props: ComponentProps<typeof DiffViewer>): void {
  mockState.codeViewProps = []
  root?.render(<DiffViewer {...props} />)
}

describe('DiffViewer CodeView item version', () => {
  beforeEach(() => {
    mockState.codeViewProps = []
    mockState.codeViewHandle = {
      scrollTo: vi.fn(),
      getInstance: vi.fn(() => ({ getScrollTop: () => 0 }))
    }
    mockState.store.settings.theme = 'dark'
    mockState.store.editorFontZoomLevel = 0
    mockState.store.activeGroupIdByWorktree = {}
    mockState.store.worktreesByRepo = {}
    mockState.store.addDiffComment.mockReset()
    mockState.store.updateDiffComment.mockReset()
    mockState.store.deleteDiffComment.mockReset()
    mockState.store.scrollToDiffCommentId = null
    mockState.store.scrollToDiffCommentRequestSeq = 0
    mockState.store.setScrollToDiffCommentId.mockReset()
    mockState.store.pierreDiffCommentExpandedIdsByScope = {}
    mockState.store.updatePierreDiffCommentExpandedIds.mockReset()
  })

  it('rotates when only Pierre annotations change', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)

    function setCommentBody(body: string): void {
      mockState.store.worktreesByRepo = {
        'wt-1': [
          {
            id: 'wt-1',
            diffComments: [
              {
                id: 'comment-1',
                worktreeId: 'wt-1',
                filePath: 'src/app.ts',
                source: 'diff',
                lineNumber: 1,
                body,
                createdAt: 1,
                updatedAt: body.length,
                side: 'modified'
              }
            ]
          }
        ]
      }
    }

    const props = {
      modelKey: 'diff:src/app.ts',
      originalContent: 'old\n',
      modifiedContent: 'new\n',
      language: 'typescript',
      relativePath: 'src/app.ts',
      worktreeId: 'wt-1',
      diffSource: 'staged' as const,
      sideBySide: false
    }

    await act(async () => {
      setCommentBody('first body')
      renderDiffWithRoot(root, props)
    })
    const firstVersion = getOnlyCodeViewItemVersion()

    await act(async () => {
      setCommentBody('other body')
      renderDiffWithRoot(root, props)
    })
    const changedVersion = getOnlyCodeViewItemVersion()

    expect(changedVersion).not.toBe(firstVersion)

    await act(async () => {
      root?.unmount()
      root = null
    })
  })

  it('rotates when any annotation metadata field changes', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)

    function setSelectedText(selectedText: string): void {
      mockState.store.worktreesByRepo = {
        'wt-1': [
          {
            id: 'wt-1',
            diffComments: [
              {
                id: 'comment-1',
                worktreeId: 'wt-1',
                filePath: 'src/app.ts',
                source: 'diff',
                lineNumber: 1,
                body: 'same body',
                selectedText,
                createdAt: 1,
                side: 'modified'
              }
            ]
          }
        ]
      }
    }

    const props = {
      modelKey: 'diff:src/app.ts',
      originalContent: 'old\n',
      modifiedContent: 'new\n',
      language: 'typescript',
      relativePath: 'src/app.ts',
      worktreeId: 'wt-1',
      diffSource: 'staged' as const,
      sideBySide: false
    }

    await act(async () => {
      setSelectedText('before')
      renderDiffWithRoot(root, props)
    })
    const firstVersion = getOnlyCodeViewItemVersion()

    await act(async () => {
      setSelectedText('after')
      renderDiffWithRoot(root, props)
    })
    const changedVersion = getOnlyCodeViewItemVersion()

    expect(changedVersion).not.toBe(firstVersion)

    await act(async () => {
      root?.unmount()
      root = null
    })
  })

  it('rotates when modified content changes for the same tab', async () => {
    // Why: P5 swaps refreshed diffs into CodeView via the item version.
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)

    function renderModified(modifiedContent: string): void {
      renderDiffWithRoot(root, {
        modelKey: 'diff:src/app.ts',
        originalContent: 'const value = 1\n',
        modifiedContent,
        language: 'typescript',
        relativePath: 'src/app.ts',
        sideBySide: false
      })
    }

    await act(async () => renderModified('const value = 2\n'))
    const firstVersion = getOnlyCodeViewItemVersion()

    await act(async () => renderModified('const value = 3\n'))
    const changedVersion = getOnlyCodeViewItemVersion()

    await act(async () => renderModified('const value = 3\n'))
    const unchangedVersion = getOnlyCodeViewItemVersion()

    expect(changedVersion).not.toBe(firstVersion)
    expect(unchangedVersion).toBe(changedVersion)

    await act(async () => {
      root?.unmount()
      root = null
    })
  })

  it('rotates when only original content changes', async () => {
    // Why: git-add refreshes can change only the original side without a remount.
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)

    function renderOriginal(originalContent: string): void {
      renderDiffWithRoot(root, {
        modelKey: 'diff:src/app.ts',
        originalContent,
        modifiedContent: 'const value = 99\n',
        language: 'typescript',
        relativePath: 'src/app.ts',
        sideBySide: false
      })
    }

    await act(async () => renderOriginal('const value = 1\n'))
    const firstVersion = getOnlyCodeViewItemVersion()

    await act(async () => renderOriginal('const value = 2\n'))
    const changedVersion = getOnlyCodeViewItemVersion()

    expect(changedVersion).not.toBe(firstVersion)

    await act(async () => {
      root?.unmount()
      root = null
    })
  })
})
