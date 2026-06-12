import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'

/**
 * Pierre CodeView cached scroll restoration for single-file read-only Git
 * diff tabs.
 *
 * Why: DiffViewer remounts on every tab switch (it is keyed by view-state
 * scope + diff content signature), so preserving the reading position relies
 * on the modelKey scroll cache being written on unmount and re-applied via
 * CodeView.scrollTo on mount.
 */

const DIFF_SCROLLER = '.pierre-diff-scroll'

type OrcaE2EPage = Page

// Why: scroll restoration is driven by real DOM scroll events and Pierre's
// rAF render loop. The default hidden E2E window never paints, so Chromium
// suspends both — show the window and disable throttling so the scroll
// pipeline behaves like a real user session.
async function enableRenderingPipeline(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.setBackgroundThrottling(false)
      win.show()
      win.focus()
    }
  })
}

type SeededDiffs = {
  fileA: { abs: string; rel: string }
  fileB: { abs: string; rel: string }
}

async function seedTwoLargeDiffs(orcaPage: OrcaE2EPage, worktreeId: string): Promise<SeededDiffs> {
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
    const relA = `src${sep}index.ts`
    const relB = 'README.md'
    const absA = `${worktree.path}${sep}${relA}`
    const absB = `${worktree.path}${sep}${relB}`
    const contentsA = `${Array.from({ length: 600 }, (_, i) => `export const a${i} = ${i}`).join('\n')}\n`
    const contentsB = `${Array.from({ length: 600 }, (_, i) => `readme line ${i}`).join('\n')}\n`
    await window.api.fs.writeFile({ filePath: absA, content: contentsA })
    await window.api.fs.writeFile({ filePath: absB, content: contentsB })
    return {
      fileA: { abs: absA, rel: relA },
      fileB: { abs: absB, rel: relB }
    }
  }, worktreeId)
}

async function openUnstagedDiff(
  orcaPage: OrcaE2EPage,
  worktreeId: string,
  file: { abs: string; rel: string },
  language: string
): Promise<void> {
  await orcaPage.evaluate(
    ({ wId, abs, rel, lang }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().openDiff(wId, abs, rel, lang, false)
    },
    { wId: worktreeId, abs: file.abs, rel: file.rel, lang: language }
  )
  // Wait for the diff tab to be active and the Pierre scroller to be laid out
  // with real (virtualized) content height. Pierre renders into a closed
  // shadow root, so scrollable height is the observable readiness signal.
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

async function scrollDiffTo(orcaPage: OrcaE2EPage, scrollTop: number): Promise<void> {
  await orcaPage.evaluate(
    ({ selector, top }) => {
      const el = document.querySelector(selector)
      if (!el) {
        throw new Error('diff scroller not found')
      }
      el.scrollTop = top
    },
    { selector: DIFF_SCROLLER, top: scrollTop }
  )
  await orcaPage.waitForFunction(
    ({ selector, top }) => {
      const el = document.querySelector(selector)
      return el != null && Math.abs(el.scrollTop - top) <= 2
    },
    { selector: DIFF_SCROLLER, top: scrollTop },
    { polling: 100, timeout: 5_000 }
  )
}

async function getDiffScrollTop(orcaPage: OrcaE2EPage): Promise<number> {
  return orcaPage.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) {
      throw new Error('diff scroller not found')
    }
    return el.scrollTop
  }, DIFF_SCROLLER)
}

test.describe('Pierre diff scroll restore', () => {
  test('restores each diff tab to its cached scroll position when switching tabs', async ({
    electronApp,
    orcaPage
  }) => {
    await enableRenderingPipeline(electronApp)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const seeded = await seedTwoLargeDiffs(orcaPage, worktreeId)

    await openUnstagedDiff(orcaPage, worktreeId, seeded.fileA, 'typescript')
    await scrollDiffTo(orcaPage, 1_500)
    // Give the scroll listener a frame to write the cache.
    await orcaPage.waitForTimeout(250)

    await openUnstagedDiff(orcaPage, worktreeId, seeded.fileB, 'markdown')
    await scrollDiffTo(orcaPage, 600)
    await orcaPage.waitForTimeout(250)

    // Switch back to diff A: it must restore the cached 1500, not reset to top.
    await openUnstagedDiff(orcaPage, worktreeId, seeded.fileA, 'typescript')
    await orcaPage.waitForTimeout(500)
    expect(Math.abs((await getDiffScrollTop(orcaPage)) - 1_500)).toBeLessThanOrEqual(2)

    // And diff B must restore its own cached 600.
    await openUnstagedDiff(orcaPage, worktreeId, seeded.fileB, 'markdown')
    await orcaPage.waitForTimeout(500)
    expect(Math.abs((await getDiffScrollTop(orcaPage)) - 600)).toBeLessThanOrEqual(2)
  })

  test('keeps an uncached diff at Pierre default top position', async ({
    electronApp,
    orcaPage
  }) => {
    await enableRenderingPipeline(electronApp)
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const seeded = await seedTwoLargeDiffs(orcaPage, worktreeId)

    await openUnstagedDiff(orcaPage, worktreeId, seeded.fileA, 'typescript')
    // No cached value yet: stay at Pierre's default top, no first-changed-line jump.
    await orcaPage.waitForTimeout(500)
    expect(await getDiffScrollTop(orcaPage)).toBe(0)
  })
})
