import { useEffect, useMemo, type ReactNode, type JSX } from 'react'
import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { getPierreDiffThemeName, usePierreDiffThemeType } from './pierre-diff-theme'

function PierreDiffWorkerThemeSync({ themeName }: { themeName: 'pierre-dark' | 'pierre-light' }) {
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

export function PierreDiffWorkerPoolProvider({ children }: { children: ReactNode }): JSX.Element {
  const themeName = getPierreDiffThemeName(usePierreDiffThemeType())
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === 'undefined' ? 4 : Math.max(1, navigator.hardwareConcurrency || 4)
    return Math.max(2, Math.min(6, Math.floor(cores / 2)))
  }, [])

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        totalASTLRUCacheSize: 240
      }}
      highlighterOptions={{
        theme: themeName,
        tokenizeMaxLineLength: 1_000
      }}
    >
      <PierreDiffWorkerThemeSync themeName={themeName} />
      {children}
    </WorkerPoolContextProvider>
  )
}
