/**
 * Cliente do Better Auth (login por e-mail e senha). Sem baseURL: fala com `/api/auth` no
 * mesmo host que serviu o front — em produção o próprio server/, em dev o proxy do Vite.
 */
import { createAuthClient } from 'better-auth/react'
import { t } from './i18n'

export const authClient = createAuthClient()

// funções (não constantes): o idioma é lido na hora da mensagem
const ERROR_MESSAGES: Record<string, () => string> = {
  INVALID_EMAIL_OR_PASSWORD: () => t('E-mail ou senha incorretos.', 'Incorrect email or password.'),
  INVALID_EMAIL: () => t('Digite um e-mail válido.', 'Enter a valid email.'),
}

/** Quando a requisição nem chega ao server (queda de rede, conexão derrubada no caminho). */
export const connectionErrorMessage = () =>
  t(
    'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
    "We couldn't reach the server. Check your connection and try again.",
  )

/** Traduz o erro do Better Auth para uma mensagem que dá para mostrar ao morador. */
export function authErrorMessage(error: { code?: string; status?: number }): string {
  if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code]()
  if (error.status === 429)
    return t('Muitas tentativas. Espere um pouco e tente de novo.', 'Too many attempts. Wait a moment and try again.')
  return t('Não foi possível entrar agora. Tente de novo em instantes.', "Couldn't sign you in right now. Try again in a moment.")
}
