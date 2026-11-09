import { setLang, useLang } from '../lib/i18n'

/** Alterna PT / EN. A escolha vale para a landing e para o app, e fica salva neste navegador. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const lang = useLang()
  const next = lang === 'pt' ? 'en' : 'pt'
  const label = lang === 'pt' ? 'Switch to English' : 'Mudar para português'
  return (
    <button
      type="button"
      className={`lang-toggle ${className}`}
      onClick={() => setLang(next)}
      aria-label={label}
      title={label}
    >
      {lang === 'pt' ? 'EN' : 'PT'}
    </button>
  )
}
