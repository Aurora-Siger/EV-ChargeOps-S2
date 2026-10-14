import { createMiddleware } from 'hono/factory'
import { ForbiddenError, AppError } from '../../shared/errors.js'
import { auth } from './auth.js'

/** Papel na plataforma. O papel dentro de cada condomínio vem do vínculo (ver workspace.middleware). */
export type Role = 'SUPER_ADMIN' | 'USER'
export type AuthVars = { user: { id: string; role: Role; name: string; email: string } }
type Vars = AuthVars

export const requireAuth = createMiddleware<{ Variables: Vars }>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED')
  c.set('user', {
    id: session.user.id,
    role: (session.user as { role?: Role }).role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
    name: session.user.name,
    email: session.user.email,
  })
  await next()
})

export const requireSuperAdmin = createMiddleware<{ Variables: Vars }>(async (c, next) => {
  if (c.get('user').role !== 'SUPER_ADMIN') throw new ForbiddenError()
  await next()
})
