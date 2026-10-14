import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors.js'

/**
 * Único ponto que fala com o serviço de IA (Python). Rede interna do Coolify,
 * autenticada por token compartilhado. O usuário final NUNCA chama o serviço de IA direto.
 */
async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.AI_INTERNAL_TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw new AppError('Serviço de IA indisponível', 503, 'AI_UNAVAILABLE')
  })
  if (!res.ok) throw new AppError(`Serviço de IA respondeu ${res.status}`, 502, 'AI_ERROR')
  return (await res.json()) as T
}

export interface AiQuote {
  multiplier: number
  applied: { rule: string; multiplier: number; reason: string }[]
  model_version: string
}

export interface AiForecast {
  available: boolean
  reason: string | null
  hours: { at: string; multiplier: number }[]
  cheapest_at: string | null
  model_version: string
}

export const aiClient = {
  quote: (features: unknown) => post<AiQuote>('/pricing/quote', features, 2_000),
  forecast: (hoursAhead?: number) => post<AiForecast>('/pricing/forecast', { hoursAhead }, 3_000),
  chat: (payload: { userId: string; role: string; authenticated: boolean; conversationId?: string; message: string }) =>
    post<{ conversation_id: string; reply: string; action: string | null }>(
      '/agent/chat',
      {
        user_id: payload.userId,
        role: payload.role,
        authenticated: payload.authenticated,
        conversation_id: payload.conversationId,
        message: payload.message,
      },
      30_000,
    ),
}
