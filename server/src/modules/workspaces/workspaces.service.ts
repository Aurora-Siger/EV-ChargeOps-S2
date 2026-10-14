import { AppError, NotFoundError } from '../../shared/errors.js'
import { pricingQueries } from '../pricing/pricing.service.js'
import { settingsService } from '../settings/settings.service.js'
import type { AdminTitle, MemberKind, MemberRole, PlatformRole } from './domain/permissions.js'
import { workspacesRepository } from './workspaces.repository.js'

/** Condomínio em que a requisição acontece, com o papel de quem pede nele. */
export type ActiveWorkspace = {
  id: string
  name: string
  archived: boolean
  /** null: não é membro (o superadmin olhando um condomínio). */
  memberRole: MemberRole | null
  adminTitle: AdminTitle | null
  kind: MemberKind | null
}

export type Viewer = { id: string; role: PlatformRole }

/** Tarifa base de um condomínio novo; o síndico ajusta em Configurações. Mesma do seed. */
const DEFAULT_BASE_PRICE_CENTS_KWH = 52

type Membership = Awaited<ReturnType<typeof workspacesRepository.membershipsOf>>[number]

const fromMembership = (m: Membership): ActiveWorkspace => ({
  id: m.workspaceId,
  name: m.name,
  archived: m.archivedAt !== null,
  memberRole: m.role,
  adminTitle: m.adminTitle,
  kind: m.kind,
})

const asVisitor = (w: { id: string; name: string; archivedAt: Date | null }): ActiveWorkspace => ({
  id: w.id,
  name: w.name,
  archived: w.archivedAt !== null,
  memberRole: null,
  adminTitle: null,
  kind: null,
})

export const workspacesService = {
  /**
   * Condomínio ativo. Com `requestedId` (header X-Workspace-Id, escolhido no app), confere que a
   * pessoa participa dele; o superadmin entra em qualquer um, inclusive arquivado. Sem escolha,
   * o primeiro da ordem de `membershipsOf` (para o superadmin sem vínculo, o mais antigo).
   */
  async resolve(viewer: Viewer, requestedId?: string | null): Promise<ActiveWorkspace | null> {
    const superAdmin = viewer.role === 'SUPER_ADMIN'
    const memberships = await workspacesRepository.membershipsOf(viewer.id)
    if (requestedId) {
      const m = memberships.find((x) => x.workspaceId === requestedId)
      if (m && (!m.archivedAt || superAdmin)) return fromMembership(m)
      const w = superAdmin ? await workspacesRepository.find(requestedId) : null
      if (w) return asVisitor(w)
      throw new AppError('Você não participa deste condomínio', 403, 'WORKSPACE_FORBIDDEN')
    }
    const m = memberships.find((x) => !x.archivedAt)
    if (m) return fromMembership(m)
    const first = superAdmin ? await workspacesRepository.firstActive() : null
    return first ? asVisitor(first) : null
  },

  /** Condomínio padrão de quem não está no app (agente): só pelos vínculos. */
  defaultFor: (userId: string) => workspacesService.resolve({ id: userId, role: 'USER' }),

  /** Condomínios ativos da pessoa (seletor do app). */
  memberships: async (userId: string) => (await workspacesRepository.membershipsOf(userId)).filter((m) => !m.archivedAt),

  // ---------- superadmin ----------
  list: () => workspacesRepository.listWithCounts(),

  /** Cria o condomínio já com configurações e tarifa padrão. */
  async create(w: { name: string; address?: string | null }) {
    const created = await workspacesRepository.create(w)
    await settingsService.get(created.id)
    await pricingQueries.setBasePrice(created.id, DEFAULT_BASE_PRICE_CENTS_KWH)
    return created
  },

  /** Arquivar some com o condomínio das listas e do mapa; nada é apagado. */
  async update(id: string, w: { name?: string; address?: string | null; archived?: boolean }) {
    const { archived, ...rest } = w
    const row = await workspacesRepository.update(id, {
      ...rest,
      ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
    })
    if (!row) throw new NotFoundError('Condomínio')
    return row
  },

  // ---------- pedidos de acesso ----------
  async request(userId: string, workspaceId: string, message?: string | null) {
    const w = await workspacesRepository.find(workspaceId)
    if (!w || w.archivedAt) throw new NotFoundError('Condomínio')
    if (await workspacesRepository.member(workspaceId, userId)) {
      throw new AppError('Você já participa deste condomínio', 409, 'CONFLICT')
    }
    if (await workspacesRepository.pendingRequest(workspaceId, userId)) {
      throw new AppError('Você já tem um pedido aguardando resposta neste condomínio', 409, 'CONFLICT')
    }
    return workspacesRepository.createRequest({ workspaceId, userId, message: message?.trim() || null })
  },

  myRequests: (userId: string) => workspacesRepository.requestsOf(userId),

  async cancelMine(userId: string, id: string) {
    const r = await workspacesRepository.findRequest(id)
    if (!r || r.userId !== userId) throw new NotFoundError('Pedido')
    const [row] = await workspacesRepository.setRequestStatus(id, 'CANCELLED', userId)
    if (!row) throw new AppError('Este pedido já foi respondido', 409, 'CONFLICT')
  },

  requestsFor: (workspaceId: string) => workspacesRepository.requestsFor(workspaceId),

  /** Admin do condomínio aprova (a pessoa entra como convidada) ou recusa. */
  async decide(workspaceId: string, deciderId: string, id: string, approve: boolean) {
    const r = await workspacesRepository.findRequest(id)
    if (!r || r.workspaceId !== workspaceId) throw new NotFoundError('Pedido')
    const row = approve
      ? await workspacesRepository.approveRequest(r, deciderId)
      : (await workspacesRepository.setRequestStatus(id, 'REJECTED', deciderId))[0]
    if (!row) throw new AppError('Este pedido já foi respondido', 409, 'CONFLICT')
    return row
  },
}
