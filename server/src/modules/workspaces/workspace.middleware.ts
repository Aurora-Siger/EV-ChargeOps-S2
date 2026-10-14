import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AuthVars } from '../../infra/auth/middleware.js'
import { AppError, ForbiddenError } from '../../shared/errors.js'
import { canAdminWorkspace, type Actor } from './domain/permissions.js'
import { workspacesService, type ActiveWorkspace } from './workspaces.service.js'

/** O app manda o condomínio escolhido neste header em toda requisição. */
export const WORKSPACE_HEADER = 'X-Workspace-Id'

export type WorkspaceVars = AuthVars & { ws: ActiveWorkspace | null }
type Ctx = Context<{ Variables: WorkspaceVars }>

/** Resolve o condomínio ativo (depois do requireAuth). Pode ficar null: conta sem condomínio. */
export const withWorkspace = createMiddleware<{ Variables: WorkspaceVars }>(async (c, next) => {
  c.set('ws', await workspacesService.resolve(c.get('user'), c.req.header(WORKSPACE_HEADER) || null))
  await next()
})

/** Painel do gestor: superadmin ou admin (síndico/subsíndico) do condomínio ativo. */
export const requireWorkspaceAdmin = createMiddleware<{ Variables: WorkspaceVars }>(async (c, next) => {
  wsOf(c)
  if (!canAdminWorkspace(actorOf(c))) throw new ForbiddenError()
  await next()
})

/** Condomínio ativo; erro se a conta não tem nenhum. */
export function wsOf(c: Ctx): ActiveWorkspace {
  const ws = c.get('ws')
  if (!ws) throw new AppError('Nenhum condomínio selecionado', 400, 'NO_WORKSPACE')
  return ws
}

/** Quem age, com o papel que tem no condomínio ativo (regras em domain/permissions). */
export function actorOf(c: Ctx): Actor {
  const user = c.get('user')
  return { userId: user.id, platformRole: user.role, memberRole: c.get('ws')?.memberRole ?? null }
}
