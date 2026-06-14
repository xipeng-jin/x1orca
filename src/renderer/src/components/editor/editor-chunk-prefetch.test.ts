import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: the prefetch's import('./EditorPanel') / import('./DiffViewer') would pull
// the real (heavy) editor chunks into the test runner. Mock them to trivial
// modules; the editorPanelFails flag turns one into a rejecting dynamic import
// to exercise the error-swallow path.
function mockChunks({ editorPanelFails = false }: { editorPanelFails?: boolean } = {}): void {
  vi.doMock('./EditorPanel', () => {
    if (editorPanelFails) {
      throw new Error('EditorPanel chunk failed to load')
    }
    return { default: () => null }
  })
  vi.doMock('./DiffViewer', () => ({ default: () => null }))
}

async function loadPrefetch(opts: { editorPanelFails?: boolean } = {}) {
  vi.resetModules()
  mockChunks(opts)
  return import('./editor-chunk-prefetch')
}

type FakeWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  setTimeout: (callback: () => void, ms?: number) => number
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}

describe('prefetchEditorDiffChunks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./EditorPanel')
    vi.doUnmock('./DiffViewer')
  })

  it('schedules the warm-up via requestIdleCallback when available', async () => {
    const requestIdleCallback = vi.fn()
    const setTimeoutSpy = vi.fn()
    vi.stubGlobal('window', { requestIdleCallback, setTimeout: setTimeoutSpy } satisfies FakeWindow)

    const { prefetchEditorDiffChunks } = await loadPrefetch()
    prefetchEditorDiffChunks()

    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 })
    // Idle path taken, so the macrotask fallback must not also fire.
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('falls back to a macrotask when requestIdleCallback is unavailable', async () => {
    const setTimeoutSpy = vi.fn()
    vi.stubGlobal('window', { setTimeout: setTimeoutSpy } satisfies FakeWindow)

    const { prefetchEditorDiffChunks } = await loadPrefetch()
    prefetchEditorDiffChunks()

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0)
  })

  it('schedules at most once even when called repeatedly', async () => {
    const requestIdleCallback = vi.fn()
    vi.stubGlobal('window', {
      requestIdleCallback,
      setTimeout: vi.fn()
    } satisfies FakeWindow)

    const { prefetchEditorDiffChunks } = await loadPrefetch()
    prefetchEditorDiffChunks()
    prefetchEditorDiffChunks()
    prefetchEditorDiffChunks()

    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when window is undefined', async () => {
    vi.stubGlobal('window', undefined)

    const { prefetchEditorDiffChunks } = await loadPrefetch()
    expect(() => prefetchEditorDiffChunks()).not.toThrow()
  })

  it('swallows a rejected chunk import without surfacing it', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    // Run the warm-up synchronously so the rejecting import fires inside the call.
    vi.stubGlobal('window', {
      requestIdleCallback: (callback) => {
        callback()
        return 1
      },
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } satisfies FakeWindow)

    const { prefetchEditorDiffChunks } = await loadPrefetch({ editorPanelFails: true })
    expect(() => prefetchEditorDiffChunks()).not.toThrow()

    // Let the rejected import settle; .catch must absorb it so node never flags
    // an unhandled rejection.
    await flushMacrotask()
    await flushMacrotask()

    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })
})
