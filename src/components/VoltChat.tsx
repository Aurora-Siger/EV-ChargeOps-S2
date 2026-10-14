import { useEffect, useRef, useState } from 'react'
import Volt from './Volt'
import { askVolt, type ChatMessage, type VoltActionName } from '../lib/voltAgent'

type Props = {
  /** Se fornecido, o Volt pode navegar o app ao "executar" a tool navigate_to. */
  onAction?: (action: VoltActionName) => void
  /** 'app' ancora o botão dentro do frame do app, menor e sem o balão automático */
  variant?: 'site' | 'app'
}

const GREETING =
  'Oi, eu sou o Volt ⚡ Posso contar o status do seu carregador agora, seu histórico de recargas, a tarifa vigente, te levar pra outra tela ou explicar como funciona a cobrança. O que você quer saber?'

const SUGGESTIONS = ['Como está meu carregador agora?', 'Qual a tarifa neste momento?', 'Como funciona a cobrança por ociosidade?']

export default function VoltChat({ onAction, variant = 'site' }: Props) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [showBubble, setShowBubble] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'model', text: GREETING }])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, loading])

  useEffect(() => {
    if (open || variant === 'app') return
    let timer: ReturnType<typeof setTimeout>
    let visible = false
    const cycle = (delay: number) => {
      timer = setTimeout(() => {
        visible = !visible
        setShowBubble(visible)
        cycle(visible ? 5000 : 9000)
      }, delay)
    }
    cycle(2500)
    return () => clearTimeout(timer)
  }, [open, variant])

  async function send(text: string) {
    const clean = text.trim()
    if (!clean || loading) return
    setError(null)
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: clean }])
    setLoading(true)
    try {
      const { conversationId: newId, reply } = await askVolt(conversationId, clean)
      setConversationId(newId)
      setMessages((m) => [...m, { role: 'model', text: reply.text }])
      if (reply.action) onAction?.(reply.action)
    } catch {
      setError('Deu ruim aqui do meu lado, tenta de novo em instantes 🥲')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {!open && variant === 'site' && (
        <div className={`volt-bubble ${showBubble && !hover ? 'is-visible' : ''}`}>
          Oi, eu sou o Volt ⚡ estou aqui para te ajudar!
        </div>
      )}

      <button
        className={`volt-fab ${open ? 'is-open' : ''} ${variant === 'app' ? 'in-app' : ''}`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label="Falar com o Volt"
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <Volt size={variant === 'app' ? 34 : 54} headset />
        )}
      </button>

      {open && (
        <div className={`volt-panel ${variant === 'app' ? 'in-app' : ''}`}>
          <div className="volt-panel-head">
            <Volt size={34} headset />
            <div>
              <div className="who">Volt</div>
              <div className="hint">assistente do Chargefy</div>
            </div>
          </div>

          <div className="volt-panel-body" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`volt-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="volt-msg model volt-typing">
                <span />
                <span />
                <span />
              </div>
            )}
            {error && <div className="volt-msg error">{error}</div>}
          </div>

          {messages.length <= 1 && !loading && (
            <div className="volt-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="volt-panel-form"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte algo ao Volt…"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()} aria-label="Enviar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 14-7-7 14-2-5-5-2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  )
}
