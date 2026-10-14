import { aiClient } from '../../infra/ai/aiClient.js'

// O cérebro do agente vive em Python (ai/). Aqui só ficam autenticação e roteamento.
export const agentService = {
  chat: (user: { id: string; role: string; authenticated: boolean }, conversationId: string | undefined, message: string) =>
    aiClient.chat({ userId: user.id, role: user.role, authenticated: user.authenticated, conversationId, message }),
}
