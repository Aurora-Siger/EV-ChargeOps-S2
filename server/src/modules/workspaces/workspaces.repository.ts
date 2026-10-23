import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { station, unit, user, workspace, workspaceJoinRequest, workspaceMember } from '../../infra/db/schema.js'

export type WorkspaceRow = typeof workspace.$inferSelect
export type JoinRequestRow = typeof workspaceJoinRequest.$inferSelect
type JoinStatus = JoinRequestRow['status']

export const workspacesRepository = {
  find: async (id: string) => (await db.select().from(workspace).where(eq(workspace.id, id)).limit(1))[0] ?? null,
  firstActive: async () =>
    (await db.select().from(workspace).where(isNull(workspace.archivedAt)).orderBy(asc(workspace.createdAt)).limit(1))[0] ??
    null,
  create: async (w: { name: string; address?: string | null }) => (await db.insert(workspace).values(w).returning())[0]!,
  update: async (id: string, w: Partial<Pick<WorkspaceRow, 'name' | 'address' | 'archivedAt'>>) =>
    (await db.update(workspace).set(w).where(eq(workspace.id, id)).returning())[0],

  /** Todos os condomínios com pontos de recarga, quantas pessoas e pedidos pendentes têm (tela do superadmin). */
  listWithCounts: async () => {
    const [rows, members, pending, stations] = await Promise.all([
      db.select().from(workspace).orderBy(asc(workspace.name)),
      db
        .select({ workspaceId: workspaceMember.workspaceId, kind: workspaceMember.kind, n: count() })
        .from(workspaceMember)
        .groupBy(workspaceMember.workspaceId, workspaceMember.kind),
      db
        .select({ workspaceId: workspaceJoinRequest.workspaceId, n: count() })
        .from(workspaceJoinRequest)
        .where(eq(workspaceJoinRequest.status, 'PENDING'))
        .groupBy(workspaceJoinRequest.workspaceId),
      db
        .select({ workspaceId: station.workspaceId, id: station.id, name: station.name })
        .from(station)
        .where(eq(station.kind, 'CONDOMINIO'))
        .orderBy(asc(station.name)),
    ])
    const admins = await db
      .select({
        workspaceId: workspaceMember.workspaceId,
        userId: user.id,
        name: user.name,
        email: user.email,
        title: workspaceMember.adminTitle,
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(eq(workspaceMember.role, 'ADMIN'))
    return rows.map((w) => ({
      ...w,
      residents: members.find((m) => m.workspaceId === w.id && m.kind === 'MORADOR')?.n ?? 0,
      guests: members.find((m) => m.workspaceId === w.id && m.kind === 'CONVIDADO')?.n ?? 0,
      pendingRequests: pending.find((p) => p.workspaceId === w.id)?.n ?? 0,
      admins: admins.filter((a) => a.workspaceId === w.id),
      stations: stations.filter((s) => s.workspaceId === w.id).map(({ id, name }) => ({ id, name })),
    }))
  },

  // ---------- vínculos ----------
  /**
   * Condomínios da pessoa, na ordem em que o app escolhe o ativo quando ela não escolheu:
   * onde é moradora antes de onde é convidada, admin antes de usuário, o vínculo mais antigo antes.
   */
  membershipsOf: (userId: string) =>
    db
      .select({
        workspaceId: workspace.id,
        name: workspace.name,
        archivedAt: workspace.archivedAt,
        role: workspaceMember.role,
        adminTitle: workspaceMember.adminTitle,
        kind: workspaceMember.kind,
        unitId: workspaceMember.unitId,
        unitLabel: unit.label,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .leftJoin(unit, eq(unit.id, workspaceMember.unitId))
      .where(eq(workspaceMember.userId, userId))
      .orderBy(
        sql`${workspaceMember.kind} = 'CONVIDADO'`,
        sql`${workspaceMember.role} = 'USER'`,
        asc(workspaceMember.createdAt),
      ),
  member: async (workspaceId: string, userId: string) =>
    (
      await db
        .select()
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
        .limit(1)
    )[0] ?? null,

  // ---------- pedidos de acesso ----------
  findRequest: async (id: string) =>
    (await db.select().from(workspaceJoinRequest).where(eq(workspaceJoinRequest.id, id)).limit(1))[0] ?? null,
  pendingRequest: async (workspaceId: string, userId: string) =>
    (
      await db
        .select()
        .from(workspaceJoinRequest)
        .where(
          and(
            eq(workspaceJoinRequest.workspaceId, workspaceId),
            eq(workspaceJoinRequest.userId, userId),
            eq(workspaceJoinRequest.status, 'PENDING'),
          ),
        )
        .limit(1)
    )[0] ?? null,
  createRequest: async (r: { workspaceId: string; userId: string; message?: string | null }) =>
    (await db.insert(workspaceJoinRequest).values(r).returning())[0]!,
  /** Pedidos da própria pessoa (os mais recentes primeiro), com o nome do condomínio. */
  requestsOf: (userId: string) =>
    db
      .select({
        id: workspaceJoinRequest.id,
        workspaceId: workspaceJoinRequest.workspaceId,
        workspaceName: workspace.name,
        status: workspaceJoinRequest.status,
        message: workspaceJoinRequest.message,
        createdAt: workspaceJoinRequest.createdAt,
        decidedAt: workspaceJoinRequest.decidedAt,
      })
      .from(workspaceJoinRequest)
      .innerJoin(workspace, eq(workspace.id, workspaceJoinRequest.workspaceId))
      .where(eq(workspaceJoinRequest.userId, userId))
      .orderBy(desc(workspaceJoinRequest.createdAt))
      .limit(20),
  /** Pedidos do condomínio (painel do admin): pendentes primeiro, depois os decididos recentes. */
  requestsFor: (workspaceId: string) =>
    db
      .select({
        id: workspaceJoinRequest.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        status: workspaceJoinRequest.status,
        message: workspaceJoinRequest.message,
        createdAt: workspaceJoinRequest.createdAt,
        decidedAt: workspaceJoinRequest.decidedAt,
      })
      .from(workspaceJoinRequest)
      .innerJoin(user, eq(user.id, workspaceJoinRequest.userId))
      .where(eq(workspaceJoinRequest.workspaceId, workspaceId))
      .orderBy(sql`${workspaceJoinRequest.status} <> 'PENDING'`, desc(workspaceJoinRequest.createdAt))
      .limit(50),
  setRequestStatus: (id: string, status: JoinStatus, decidedBy: string | null) =>
    db
      .update(workspaceJoinRequest)
      .set({ status, decidedBy, decidedAt: new Date() })
      .where(and(eq(workspaceJoinRequest.id, id), eq(workspaceJoinRequest.status, 'PENDING')))
      .returning(),
  /** Aprovar: o pedido fecha e a pessoa entra como convidada, numa transação só. */
  approveRequest: (r: JoinRequestRow, decidedBy: string) =>
    db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaceJoinRequest)
        .set({ status: 'APPROVED', decidedBy, decidedAt: new Date() })
        .where(and(eq(workspaceJoinRequest.id, r.id), eq(workspaceJoinRequest.status, 'PENDING')))
        .returning()
      if (!updated) return null
      await tx
        .insert(workspaceMember)
        .values({ workspaceId: r.workspaceId, userId: r.userId, role: 'USER', kind: 'CONVIDADO' })
        .onConflictDoNothing()
      return updated
    }),
}
