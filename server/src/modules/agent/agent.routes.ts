import { Hono } from 'hono'
import { z } from 'zod'
import { auth } from '../../infra/auth/auth.js'
import { AppError } from '../../shared/errors.js'
import { agentService } from './agent.service.js'
import { clientIp, createRateLimiter } from './rateLimit.js'

const body = z.object({
  // Na landing (sem login) a conversa é identificada por um id gerado no navegador
  // (localStorage). Logado, vale o usuário da sessão e este campo é ignorado.
  visitorId: z.string().min(8).max(100),
  conversationId: z.string().optional(),
  message: z.string().min(1).max(2000),
})

// Barreira de custo/abuso da rota (ver docs/ARCHITECTURE.md §6, "Custo/abuso"): 7 mensagens
// por minuto por usuário logado ou por visitante. Sem login, o id de visitante vem do
// navegador e troca à vontade, então conta também por IP — com folga, porque numa rede
// compartilhada (o Wi-Fi de uma sala, por exemplo) vários visitantes saem pelo mesmo IP.
const MAX_PER_MINUTE = 7
const MAX_PER_IP_PER_MINUTE = 30
const limiter = createRateLimiter(60_000)

export const agentRoutes = new Hono().post('/chat', async (c) => {
  const { visitorId, conversationId, message } = body.parse(await c.req.json())
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  const who = session
    ? { id: session.user.id, role: (session.user as { role?: string }).role ?? 'USER', authenticated: true }
    : { id: visitorId, role: 'USER', authenticated: false }
  const ip = who.authenticated ? null : clientIp((name) => c.req.header(name))
  if (!limiter.hit(who.id, MAX_PER_MINUTE) || (ip && !limiter.hit(`ip:${ip}`, MAX_PER_IP_PER_MINUTE))) {
    throw new AppError('Muitas mensagens em pouco tempo, espera um minuto', 429, 'RATE_LIMITED')
  }
  return c.json(await agentService.chat(who, conversationId, message))
})
