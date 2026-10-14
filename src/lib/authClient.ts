/**
 * Cliente do Better Auth (login por e-mail e senha). Sem baseURL: fala com `/api/auth` no
 * mesmo host que serviu o front — em produção o próprio server/, em dev o proxy do Vite.
 */
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_EMAIL: 'Digite um e-mail válido.',
}

/** Quando a requisição nem chega ao server (queda de rede, conexão derrubada no caminho). */
export const CONNECTION_ERROR_MESSAGE = 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'

/** Traduz o erro do Better Auth para uma mensagem que dá para mostrar ao morador. */
export function authErrorMessage(error: { code?: string; status?: number }): string {
  if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code]
  if (error.status === 429) return 'Muitas tentativas. Espere um pouco e tente de novo.'
  return 'Não foi possível entrar agora. Tente de novo em instantes.'
}
