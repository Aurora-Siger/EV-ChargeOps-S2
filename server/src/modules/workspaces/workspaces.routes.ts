import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requireSuperAdmin, type AuthVars } from '../../infra/auth/middleware.js'
import { residentsService } from '../residents/residents.service.js'
import { workspacesService } from './workspaces.service.js'

const workspaceBody = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).nullish(),
})

/**
 * Administração da plataforma (só SUPER_ADMIN): criar, editar e arquivar condomínios. O resto
 * de cada condomínio (pessoas, síndico, unidades...) é o painel do gestor com ele ativo.
 */
export const superRoutes = new Hono<{ Variables: AuthVars }>()
  .use(requireAuth, requireSuperAdmin)
  .get('/workspaces', async (c) => c.json(await workspacesService.list()))
  // condomínio novo já pode nascer com o síndico
  .post('/workspaces', async (c) => {
    const body = workspaceBody
      .extend({
        sindico: z
          .object({
            name: z.string().trim().min(1).max(120),
            email: z.string().email(),
            password: z.string().min(8).max(128),
          })
          .nullish(),
      })
      .parse(await c.req.json())
    const { sindico, ...w } = body
    const created = await workspacesService.create(w)
    if (sindico) {
      const actor = { userId: c.get('user').id, platformRole: 'SUPER_ADMIN' as const, memberRole: null }
      await residentsService.createUser(actor, created.id, { ...sindico, role: 'ADMIN', adminTitle: 'SINDICO' })
    }
    return c.json(created, 201)
  })
  .patch('/workspaces/:id', async (c) => {
    const body = workspaceBody.partial().extend({ archived: z.boolean().optional() }).parse(await c.req.json())
    return c.json(await workspacesService.update(c.req.param('id'), body))
  })
