// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../../shared/types'
import { SourceControlDiffCommentsInlineList } from './source-control-diff-comments-inline-list'

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
  return {
    id: 'comment-1',
    worktreeId: 'wt-1',
    filePath: 'src/app.ts',
    source: 'diff',
    lineNumber: 30,
    body: 'Review this line',
    createdAt: 1,
    side: 'modified',
    ...overrides
  }
}

function setupApi(): { writeClipboardText: ReturnType<typeof vi.fn> } {
  const writeClipboardText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ui: {
        writeClipboardText
      }
    }
  })
  return { writeClipboardText }
}

describe('SourceControlDiffCommentsInlineList', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setupApi()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps the scroll-to-note action hover/focus revealed and routes through onOpen', () => {
    const onOpen = vi.fn()
    const comment = makeComment()

    act(() => {
      root.render(
        <SourceControlDiffCommentsInlineList
          comments={[comment]}
          onOpen={onOpen}
          onDelete={vi.fn()}
          onClearFile={vi.fn()}
        />
      )
    })

    const scrollButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Scroll to note on line 30"]'
    )

    expect(scrollButton).not.toBeNull()
    expect(scrollButton?.className).toContain('can-hover:opacity-0')
    expect(scrollButton?.className).toContain('group-hover:opacity-100')

    act(() => {
      scrollButton?.click()
    })

    expect(onOpen).toHaveBeenCalledWith(comment)
  })

  it('keeps row, copy, and delete actions wired', () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    const comment = makeComment()

    act(() => {
      root.render(
        <SourceControlDiffCommentsInlineList
          comments={[comment]}
          onOpen={onOpen}
          onDelete={onDelete}
          onClearFile={vi.fn()}
        />
      )
    })

    const rowButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Open note on line 30"]'
    )
    const copyButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy note on line 30"]'
    )
    const deleteButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete note on line 30"]'
    )

    expect(rowButton).not.toBeNull()
    expect(copyButton).not.toBeNull()
    expect(deleteButton).not.toBeNull()

    act(() => {
      rowButton?.click()
      copyButton?.click()
      deleteButton?.click()
    })

    expect(onOpen).toHaveBeenCalledWith(comment)
    expect(window.api.ui.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining(comment.body)
    )
    expect(onDelete).toHaveBeenCalledWith(comment.id)
  })
})
