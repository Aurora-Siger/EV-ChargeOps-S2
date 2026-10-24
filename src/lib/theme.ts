import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'chargefy-theme'

/** O que o usuário escolheu; sem escolha, segue o sistema. */
export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme
  return set === 'light' ? 'light' : 'dark'
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // modo privado: vale só nesta aba
  }
  window.dispatchEvent(new Event('chargefy-theme'))
}

function subscribe(cb: () => void) {
  window.addEventListener('chargefy-theme', cb)
  return () => window.removeEventListener('chargefy-theme', cb)
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as Theme)
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}

/** Preferência salva (ou do sistema), usada ao sair de uma página que força o escuro. */
export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {
    // sem storage
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** A landing é só escura: força o tema enquanto estiver montada, sem mexer na preferência. */
export function forceDark() {
  document.documentElement.dataset.theme = 'dark'
  return () => {
    document.documentElement.dataset.theme = savedTheme()
    window.dispatchEvent(new Event('chargefy-theme'))
  }
}
