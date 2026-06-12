import { useEffect, useRef, type ReactNode, type JSX } from 'react'
import { WorkerPoolContext, useWorkerPool } from '@pierre/diffs/react'
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from '@pierre/diffs/worker'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { useAppStore, type AppState } from '@/store'
import { e2eConfig } from '@/lib/e2e-config'
import {
  getPierreDiffThemeName,
  usePierreDiffThemeType,
  type PierreDiffThemeName
} from './pierre-diff-theme'
import { isSingleFileDiffTab } from './single-file-diff-tab'

// Why: Pierre's stock WorkerPoolContextProvider terminates the pool singleton
// (workers + highlight AST LRU) when the last provider unmounts, and dev
// StrictMode's simulated unmount transiently hits that path too. Owning the
// singleton here, with no terminate call anywhere, keeps the pool and its
// highlight cache alive for the life of the window so re-opened diffs paint
// highlighted on the first frame.
let acquiredWorkerPool: WorkerPoolManager | undefined

function acquirePierreDiffWorkerPool(themeName: PierreDiffThemeName): WorkerPoolManager {
  // Idempotent, so calling from render (incl. StrictMode double-render) is safe.
  acquiredWorkerPool ??= getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory: () => new DiffsWorker(),
      poolSize: getPierreDiffWorkerPoolSize(),
      totalASTLRUCacheSize: 240
    },
    // Pierre freezes these at pool creation; later theme changes flow through
    // PierreDiffWorkerThemeSync -> setRenderOptions instead.
    highlighterOptions: {
      theme: themeName,
      tokenizeMaxLineLength: 1_000
    }
  })
  // Why: same gate as window.__store - Pierre renders inside a closed shadow
  // root, so E2E/debugging observe pool lifecycle via getStats(), not the DOM.
  if (import.meta.env.DEV || e2eConfig.exposeStore) {
    ;(window as unknown as Record<string, unknown>).__pierreDiffWorkerPool = acquiredWorkerPool
  }
  return acquiredWorkerPool
}

function getPierreDiffWorkerPoolSize(): number {
  const cores =
    typeof navigator === 'undefined' ? 4 : Math.max(1, navigator.hardwareConcurrency || 4)
  return Math.max(2, Math.min(6, Math.floor(cores / 2)))
}

// Why: the pool spawns 2-6 workers, so it stays unallocated until the first
// signal that diffs will be used: the Source Control panel visible (warms the
// pool before the first row click) or a single-file diff tab open anywhere
// (covers session restore and tab groups the sidebar trigger misses).
export function isPierreDiffWorkerPoolWanted(
  state: Pick<AppState, 'rightSidebarOpen' | 'rightSidebarTab' | 'openFiles'>
): boolean {
  if (state.rightSidebarOpen && state.rightSidebarTab === 'source-control') {
    return true
  }
  return state.openFiles.some(isSingleFileDiffTab)
}

function PierreDiffWorkerThemeSync({ themeName }: { themeName: PierreDiffThemeName }) {
  const workerPool = useWorkerPool()

  useEffect(() => {
    if (!workerPool) {
      return
    }
    const current = workerPool.getDiffRenderOptions()
    if (current.theme === themeName) {
      return
    }
    void workerPool.setRenderOptions({ ...current, theme: themeName }).catch(() => undefined)
  }, [themeName, workerPool])

  return null
}

/**
 * App-wide Pierre worker pool provider. Mount exactly once, above every tab
 * group (split panes included), and never unmount it: CodeView paints nothing
 * while the pool initializes, and Orca's stable cacheKeys only pay off while
 * the pool's highlight LRU survives tab switches.
 */
export function PierreDiffWorkerPoolProvider({ children }: { children: ReactNode }): JSX.Element {
  const themeName = getPierreDiffThemeName(usePierreDiffThemeType())
  const poolWanted = useAppStore(isPierreDiffWorkerPoolWanted)

  // Why: latch - once diffs have been needed, keep providing the pool even if
  // the demand signal clears (sidebar closed, diff tabs closed), so the next
  // diff open skips pool re-init and hits the live highlight cache.
  const poolLatchedRef = useRef(false)
  if (poolWanted) {
    poolLatchedRef.current = true
  }

  const workerPool =
    poolLatchedRef.current && typeof window !== 'undefined'
      ? acquirePierreDiffWorkerPool(themeName)
      : undefined

  return (
    <WorkerPoolContext.Provider value={workerPool}>
      {workerPool != null ? <PierreDiffWorkerThemeSync themeName={themeName} /> : null}
      {children}
    </WorkerPoolContext.Provider>
  )
}
