import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/types'

export type PierreDiffThemeType = 'dark' | 'light'
export type PierreDiffThemeName = 'pierre-dark' | 'pierre-light'

export const PIERRE_DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_MODE_QUERY).matches
    : true
}

export function resolvePierreDiffThemeType(
  theme: GlobalSettings['theme'] | undefined,
  systemPrefersDark: boolean
): PierreDiffThemeType {
  if (theme === 'light') {
    return 'light'
  }
  if (theme === 'dark') {
    return 'dark'
  }
  return systemPrefersDark ? 'dark' : 'light'
}

export function getPierreDiffThemeName(themeType: PierreDiffThemeType): PierreDiffThemeName {
  return themeType === 'dark' ? 'pierre-dark' : 'pierre-light'
}

export function usePierreDiffThemeType(): PierreDiffThemeType {
  const settingsTheme = useAppStore((s) => s.settings?.theme)
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(DARK_MODE_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return resolvePierreDiffThemeType(settingsTheme, systemPrefersDark)
}
