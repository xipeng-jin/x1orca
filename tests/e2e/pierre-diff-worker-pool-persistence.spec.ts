import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import type { PierreWorkerPoolStats } from './helpers/runtime-types'

/**
 * P1: persistent, early Pierre worker pool.
 *
 * Why: the pool used to mount/unmount with the active diff tab, so every
 * switch to a non-diff tab terminated the workers and the highlight AST LRU,
 * and the next diff open re-paid full pool init (during which CodeView paints
 * nothing). The pool is now app-wide and latched: it spawns on first demand
 * (Source Control visible or a single-file diff tab) and survives for the
 * life of the window. Pierre renders into a closed shadow root, so these
 * tests observe the pool through window.__pierreDiffWorkerPool.getStats().
 */

const DIFF_SCROLLER = '.pierre-diff-scroll'
const POOL_TAG = 'p1-persistent-pool'

// Why: hidden headless Electron windows never paint, which suspends Pierre's
// rAF render loop, so show the window and disable throttling first.
async function enableRenderingPipeline(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.setBackgroundThrottling(false)
      win.show()
      win.focus()
    }
  })
}

type SeededFile = { abs: string; rel: string }

async function seedUnstagedFile(orcaPage: Page, worktreeId: string): Promise<SeededFile> {
  return orcaPage.evaluate(async (wId) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available - is the app in e2e mode?')
    }
    const state = store.getState()
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === wId)
    if (!worktree) {
      throw new Error('active worktree not found')
    }
    const sep = worktree.path.includes('\\') ? '\\' : '/'
    const rel = `src${sep}index.ts`
    const abs = `${worktree.path}${sep}${rel}`
    const contents = `${Array.from({ length: 600 }, (_, i) => `export const a${i} = ${i}`).join('\n')}\n`
    await window.api.fs.writeFile({ filePath: abs, content: contents })
    return { abs, rel }
  }, worktreeId)
}

async function openUnstagedDiff(
  orcaPage: Page,
  worktreeId: string,
  file: SeededFile
): Promise<void> {
  await orcaPage.evaluate(
    ({ wId, abs, rel }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openDiff(wId, abs, rel, 'typescript', false)
    },
    { wId: worktreeId, abs: file.abs, rel: file.rel }
  )
  await orcaPage.waitForFunction(
    ({ selector, rel }) => {
      const state = window.__store?.getState()
      if (!state) {
        return false
      }
      const activeFileId = state.activeFileIdByWorktree?.[state.activeWorktreeId ?? ''] ?? ''
      const normalizedRel = rel.replaceAll('\\', '/')
      if (!activeFileId.endsWith(`::diff::unstaged::${normalizedRel}`)) {
        return false
      }
      const el = document.querySelector(selector)
      return el != null && el.scrollHeight > el.clientHeight + 2_000
    },
    { selector: DIFF_SCROLLER, rel: file.rel },
    { polling: 100, timeout: 20_000 }
  )
}

async function openPlainEditorTab(
  orcaPage: Page,
  worktreeId: string,
  file: SeededFile
): Promise<void> {
  await orcaPage.evaluate(
    ({ wId, abs, rel }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openFile({
        filePath: abs,
        relativePath: rel,
        worktreeId: wId,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { wId: worktreeId, abs: file.abs, rel: file.rel }
  )
  // The diff scroller unmounting confirms the active tab is no longer the diff.
  await orcaPage.waitForFunction(
    (selector) => document.querySelector(selector) == null,
    DIFF_SCROLLER,
    { polling: 100, timeout: 10_000 }
  )
}

async function readPoolStats(orcaPage: Page): Promise<PierreWorkerPoolStats | null> {
  return orcaPage.evaluate(() => window.__pierreDiffWorkerPool?.getStats() ?? null)
}

async function readPoolTag(orcaPage: Page): Promise<string | null> {
  return orcaPage.evaluate(() => window.__pierreDiffWorkerPool?.__e2eInstanceTag ?? null)
}

test.describe('Pierre diff worker pool persistence (P1)', () => {
  test('spawns no workers while neither source control nor a diff is opened', async ({
    orcaPage
  }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)

    // Sanity: this session must not start with the demand signal already on.
    const sidebar = await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return state ? { open: state.rightSidebarOpen, tab: state.rightSidebarTab } : null
    })
    expect(sidebar).not.toBeNull()
    expect(sidebar?.open && sidebar?.tab === 'source-control').toBeFalsy()

    // Give any stray initialization a moment, then confirm no pool exists.
    await orcaPage.waitForTimeout(1_000)
    expect(await readPoolStats(orcaPage)).toBeNull()
  })

  test('keeps the same initialized pool and highlight cache across a non-diff tab switch', async ({
    electronApp,
    orcaPage
  }) => {
    await enableRenderingPipeline(electronApp)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const seeded = await seedUnstagedFile(orcaPage, worktreeId)

    expect(await readPoolStats(orcaPage)).toBeNull()

    await openUnstagedDiff(orcaPage, worktreeId, seeded)

    // The pool must come up and finish the whole-diff highlight (LRU entry).
    await orcaPage.waitForFunction(
      () => {
        const stats = window.__pierreDiffWorkerPool?.getStats()
        return (
          stats != null &&
          stats.managerState === 'initialized' &&
          stats.totalWorkers >= 2 &&
          stats.diffCacheSize >= 1
        )
      },
      undefined,
      { polling: 100, timeout: 20_000 }
    )
    const warmStats = await readPoolStats(orcaPage)
    await orcaPage.evaluate((tag) => {
      if (window.__pierreDiffWorkerPool) {
        window.__pierreDiffWorkerPool.__e2eInstanceTag = tag
      }
    }, POOL_TAG)

    // Switch to a non-diff editor tab: before P1 this terminated the pool
    // (workers gone, managerState back to 'waiting', caches cleared).
    await openPlainEditorTab(orcaPage, worktreeId, seeded)
    await orcaPage.waitForTimeout(500)

    expect(await readPoolTag(orcaPage)).toBe(POOL_TAG)
    const statsAfterSwitch = await readPoolStats(orcaPage)
    expect(statsAfterSwitch?.managerState).toBe('initialized')
    expect(statsAfterSwitch?.totalWorkers).toBe(warmStats?.totalWorkers)
    expect(statsAfterSwitch?.diffCacheSize).toBeGreaterThanOrEqual(1)

    // Reopen the diff: same pool instance, no re-init, cache still warm - the
    // preconditions for CodeView's first frame painting already highlighted.
    await openUnstagedDiff(orcaPage, worktreeId, seeded)
    expect(await readPoolTag(orcaPage)).toBe(POOL_TAG)
    const statsAfterReopen = await readPoolStats(orcaPage)
    expect(statsAfterReopen?.managerState).toBe('initialized')
    expect(statsAfterReopen?.totalWorkers).toBe(warmStats?.totalWorkers)
    expect(statsAfterReopen?.diffCacheSize).toBeGreaterThanOrEqual(1)
  })
})
