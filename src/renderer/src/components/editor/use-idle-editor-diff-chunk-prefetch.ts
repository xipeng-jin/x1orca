import { useEffect } from 'react'
import { prefetchEditorDiffChunks } from './editor-chunk-prefetch'

// Why: warm the lazy EditorPanel + DiffViewer chunks during idle time once the
// workspace session is up, so the first diff open isn't gated on two nested
// Suspense "Loading editor..." fallbacks. Gated on `ready` so the warm-up never
// competes with the hydration path; prefetchEditorDiffChunks is itself
// idle-scheduled and latched, so it stays off first paint and runs at most once.
export function useIdleEditorDiffChunkPrefetch(ready: boolean): void {
  useEffect(() => {
    if (!ready) {
      return
    }
    prefetchEditorDiffChunks()
  }, [ready])
}
