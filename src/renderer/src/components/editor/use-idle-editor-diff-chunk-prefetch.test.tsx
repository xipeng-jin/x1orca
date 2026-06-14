// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Spy on the scheduler so these tests assert the gating wiring (does the hook
// call it, and when) without scheduling a real idle import.
const prefetchSpy = vi.hoisted(() => vi.fn())
vi.mock('./editor-chunk-prefetch', () => ({
  prefetchEditorDiffChunks: prefetchSpy
}))

import { useIdleEditorDiffChunkPrefetch } from './use-idle-editor-diff-chunk-prefetch'

function HookProbe({ ready }: { ready: boolean }): null {
  useIdleEditorDiffChunkPrefetch(ready)
  return null
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
  prefetchSpy.mockClear()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = undefined
  container = undefined
})

describe('useIdleEditorDiffChunkPrefetch', () => {
  it('does not prefetch while the workspace session is not ready', () => {
    render(<HookProbe ready={false} />)
    expect(prefetchSpy).not.toHaveBeenCalled()
  })

  it('prefetches once the workspace session becomes ready', () => {
    render(<HookProbe ready={false} />)
    expect(prefetchSpy).not.toHaveBeenCalled()

    render(<HookProbe ready={true} />)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prefetches at most once across re-renders while ready stays true', () => {
    render(<HookProbe ready={true} />)
    render(<HookProbe ready={true} />)
    render(<HookProbe ready={true} />)
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })
})
