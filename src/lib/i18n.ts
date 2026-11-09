import { useSyncExternalStore } from 'react'

/**
 * Idioma da interface (português ou inglês). A escolha fica salva no navegador e vale para a
 * landing e para o app. Os textos ficam no próprio componente, em pares: t('Agendar', 'Schedule').
 */
export type Lang = 'pt' | 'en'

const KEY = 'chargefy-lang'
const EVENT = 'chargefy-lang'

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'pt' || saved === 'en') return saved
  } catch {
    // sem storage
  }
  return 'pt'
}

let lang: Lang = typeof window === 'undefined' ? 'pt' : initial()
if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR'

export const getLang = () => lang
export const isEn = () => lang === 'en'

/** Texto no idioma atual. */
export function t(pt: string, en: string) {
  return lang === 'en' ? en : pt
}

/** Locale para Intl (números e datas). */
export const locale = () => (lang === 'en' ? 'en-US' : 'pt-BR')

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  document.documentElement.lang = next === 'en' ? 'en' : 'pt-BR'
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // modo privado: vale só nesta aba
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  // outra aba trocou o idioma
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && (e.newValue === 'pt' || e.newValue === 'en') && e.newValue !== lang) setLang(e.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'pt' as Lang)
}

/**
 * Tabela de rótulos que resolve o idioma na hora da leitura:
 * labels({ PAID: ['Paga', 'Paid'] }).PAID
 */
export function labels<K extends string>(map: Record<K, readonly [string, string]>): Readonly<Record<K, string>> {
  return new Proxy({} as Record<K, string>, {
    get(_, key: string) {
      const pair = (map as Record<string, readonly [string, string]>)[key]
      return pair ? t(pair[0], pair[1]) : undefined
    },
    has(_, key) {
      return key in map
    },
    ownKeys() {
      return Reflect.ownKeys(map)
    },
    getOwnPropertyDescriptor(_, key) {
      return key in map ? { enumerable: true, configurable: true } : undefined
    },
  })
}

/** Lista que resolve o idioma na hora da leitura (ex.: dias da semana). */
export function list(pt: readonly string[], en: readonly string[]): readonly string[] {
  return new Proxy([...pt], {
    get(_, key) {
      const arr = lang === 'en' ? en : pt
      const v = Reflect.get(arr, key)
      return typeof v === 'function' ? v.bind(arr) : v
    },
  })
}
