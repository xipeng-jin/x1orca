import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import App from './App'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { shouldEnableReactGrab } from './lib/react-grab-dev-gate'
import { I18nProvider } from './i18n/I18nProvider'
import { translate } from './i18n/i18n'
import { PierreDiffWorkerPoolProvider } from './components/editor/PierreDiffWorkerPoolProvider'

recordRendererCrashBreadcrumb('renderer_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics()

if (
  import.meta.env.DEV &&
  shouldEnableReactGrab({
    dev: import.meta.env.DEV,
    enableFlag: import.meta.env.VITE_ENABLE_REACT_GRAB
  })
) {
  void import('react-grab').then(({ init }) => init())
  void import('react-grab/styles.css')
}

applyDocumentTheme('system', { disableTransitions: false })

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('renderer_root_missing')
  throw new Error('Renderer root element not found.')
}

function RendererRoot(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="app.root"
      surface="app-root"
      title={translate('app.recoverableError.rootTitle', 'Orca hit a renderer error.')}
      description={translate(
        'app.recoverableError.rootDescription',
        'The app shell could not finish rendering. Retry to remount it, or relaunch Orca if the error persists.'
      )}
    >
      {/* Why: the Pierre diff worker pool must outlive tab switches and serve
          every tab group from one instance, so its provider mounts here for
          the life of the window. It spawns no workers until a diff surface
          is first needed (see PierreDiffWorkerPoolProvider). */}
      <PierreDiffWorkerPoolProvider>
        <App />
      </PierreDiffWorkerPoolProvider>
    </RecoverableRenderErrorBoundary>
  )
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <RendererRoot />
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('renderer_bootstrap_rendered')
