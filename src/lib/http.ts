/**
 * Cliente HTTP do app: mesma origem (cookie do Better Auth vai junto), JSON nos dois
 * sentidos, a mensagem de erro do backend (`{ error, message }`) propagada para a tela e o
 * condomínio ativo no header X-Workspace-Id.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Sua sessão expirou. Entre de novo.',
  403: 'Você não tem permissão para isso.',
  404: 'Não encontrado.',
  409: 'Conflito com um cadastro existente.',
}

// ---------- condomínio ativo ----------
// Escolhido no app (quem participa de mais de um, ou o superadmin) e lembrado neste navegador.
// Sem escolha, o servidor usa o padrão da pessoa.

const WORKSPACE_KEY = 'chargefy.workspace'

let activeWorkspace: string | null = (() => {
  try {
    return localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
})()

export const activeWorkspaceId = () => activeWorkspace

export function setActiveWorkspace(id: string | null) {
  activeWorkspace = id
  try {
    if (id) localStorage.setItem(WORKSPACE_KEY, id)
    else localStorage.removeItem(WORKSPACE_KEY)
  } catch {
    /* sem storage: fica só na memória */
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const send = (workspace: string | null) =>
    fetch(path, {
      credentials: 'same-origin',
      ...rest,
      headers: {
        ...(json !== undefined && { 'Content-Type': 'application/json' }),
        ...(workspace && { 'X-Workspace-Id': workspace }),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  let res: Response
  let body: { error?: string; message?: string; issues?: { path?: string[]; message: string }[] } | null
  try {
    const sent = activeWorkspace
    res = await send(sent)
    body = res.status === 204 ? null : await res.json().catch(() => null)
    // condomínio lembrado que a conta não usa mais (saiu, arquivado, outro login): volta pro padrão
    if (sent && res.status === 403 && body?.error === 'WORKSPACE_FORBIDDEN') {
      setActiveWorkspace(null)
      res = await send(null)
      body = res.status === 204 ? null : await res.json().catch(() => null)
    }
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0)
  }
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const issue = body?.issues?.[0]
    const message =
      body?.message ?? (issue ? `${issue.path?.join('.') ?? ''} ${issue.message}`.trim() : null) ?? FALLBACK[res.status]
    throw new ApiError(message ?? `Erro ${res.status}`, res.status, body?.error)
  }
  return body as T
}
