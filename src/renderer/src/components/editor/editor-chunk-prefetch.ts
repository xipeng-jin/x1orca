// Why: the first-ever editor/diff open pays two nested Suspense "Loading
// editor..." fallbacks while the lazy EditorPanel chunk and the (nested,
// in-series) DiffViewer chunk download and evaluate. Warming both during idle
// time after the workspace mounts takes them off the cold-start critical path.
// Electron serves these chunks from local disk in both local and SSH
// workspaces, so the warm-up is cheap.

// Why: these specifiers resolve to the exact modules the lazy() mount sites load
// (EditorContent's `./DiffViewer`; the EditorPanel lazy sites), so the bundler
// reuses the existing chunks here instead of emitting duplicates.
const importEditorPanelChunk = (): Promise<unknown> => import('./EditorPanel')
const importDiffViewerChunk = (): Promise<unknown> => import('./DiffViewer')

// Why: latched so the warm-up is scheduled at most once per window even if the
// caller's effect re-runs (StrictMode double-invoke, dependency churn).
let prefetchScheduled = false

export function prefetchEditorDiffChunks(): void {
  if (prefetchScheduled || typeof window === 'undefined') {
    return
  }
  prefetchScheduled = true

  const warm = (): void => {
    // Why: swallow warm-up failures entirely — the real lazy() retries on actual
    // use, so a rejected prefetch import must never surface to the user.
    void importEditorPanelChunk().catch(() => undefined)
    void importDiffViewerChunk().catch(() => undefined)
  }

  // Why: requestIdleCallback keeps the warm-up behind first paint and real work;
  // fall back to a macrotask where it is unavailable (tests/older runtimes) so
  // the prefetch still runs without blocking startup.
  const scheduler = window as Window & {
    requestIdleCallback?: Window['requestIdleCallback']
  }
  if (typeof scheduler.requestIdleCallback === 'function') {
    scheduler.requestIdleCallback(warm, { timeout: 2_000 })
    return
  }
  window.setTimeout(warm, 0)
}

// Why: the module-level latch persists for the file's lifetime; tests reset it
// between cases (mirrors resetEditorDiffClickHandoffForTests in
// editor-content-fetch.ts).
export function resetEditorDiffChunksPrefetchForTests(): void {
  prefetchScheduled = false
}
