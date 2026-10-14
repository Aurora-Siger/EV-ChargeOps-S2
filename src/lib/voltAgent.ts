/**
 * Cliente do Volt: fala com `POST /api/agent/chat`, que roteia pro agente LangGraph em
 * `ai/` (status do carregador, histórico, tarifa, fatura do usuário, RAG).
 *
 * Quem está logado é identificado pelo server a partir do cookie de sessão. O id de
 * visitante salvo no localStorage só serve para separar conversas e aplicar o limite de
 * mensagens de quem usa o Volt da landing sem login.
 */

const ENDPOINT = '/api/agent/chat'
const VISITOR_KEY = 'chargefy_visitor_id'

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    // localStorage indisponível (modo privado, etc.): usa um id só desta aba/execução.
    return crypto.randomUUID()
  }
}

export type ChatRole = 'user' | 'model'
export type ChatMessage = { role: ChatRole; text: string }

/** Telas do app para onde o Volt pode levar o usuário (tool `navigate_to` do agente). */
export const VOLT_ACTIONS = ['ir_para_inicio', 'ir_para_agendamento', 'ir_para_fatura', 'ir_para_painel_gestor'] as const
export type VoltActionName = (typeof VOLT_ACTIONS)[number]

const ACTION_MAP: Record<string, VoltActionName> = {
  inicio: 'ir_para_inicio',
  agendamento: 'ir_para_agendamento',
  fatura: 'ir_para_fatura',
  painel_gestor: 'ir_para_painel_gestor',
}

export type VoltReply = { text: string; action?: VoltActionName }

type ChatResponse = { conversation_id: string; reply: string; action?: string | null }

export async function askVolt(conversationId: string | undefined, message: string): Promise<{ conversationId: string; reply: VoltReply }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: visitorId(), conversationId, message }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`agent_http_${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as ChatResponse
  const action = data.action ? ACTION_MAP[data.action] : undefined
  return { conversationId: data.conversation_id, reply: { text: data.reply, action } }
}
