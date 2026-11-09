import { useEffect, useRef, useState } from 'react'
import { setLang, useLang, type Lang } from '../lib/i18n'

const OPTIONS: { code: Lang; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
]

/** Globo que abre PT / EN. A escolha vale para a landing e para o app, e fica salva neste navegador. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`lang-menu ${className}`} ref={ref}>
      <button
        type="button"
        className="lang-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language / Idioma"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Language / Idioma"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
        </svg>
        <span>{lang.toUpperCase()}</span>
      </button>
      {open && (
        <ul className="lang-pop" role="listbox">
          {OPTIONS.map((o) => (
            <li key={o.code} role="option" aria-selected={o.code === lang}>
              <button
                type="button"
                className={o.code === lang ? 'on' : ''}
                onClick={() => {
                  setLang(o.code)
                  setOpen(false)
                }}
              >
                <b>{o.code.toUpperCase()}</b> {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
