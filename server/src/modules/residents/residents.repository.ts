import { and, asc, count, eq, sql } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { charger, rfidCard, station, unit, user, vehicle, workspaceMember } from '../../infra/db/schema.js'

export type MemberValues = typeof workspaceMember.$inferInsert
export type MemberPatch = Partial<Pick<MemberValues, 'role' | 'adminTitle' | 'kind' | 'unitId'>>
export type VehicleInput = { model: string; plate?: string | null; capacityKwh: number; rangeKm?: number | null; maxChargeKw: number }
export type CardInput = { cardNumber: string; userId: string; label?: string | null; active?: boolean }

const vehicleValues = (v: Partial<VehicleInput>) => ({
  ...(v.model !== undefined && { model: v.model }),
  ...(v.plate !== undefined && { plate: v.plate }),
  ...(v.capacityKwh !== undefined && { capacityKwh: String(v.capacityKwh) }),
  ...(v.rangeKm !== undefined && { rangeKm: v.rangeKm }),
  ...(v.maxChargeKw !== undefined && { maxChargeKw: String(v.maxChargeKw) }),
})

const toVehicle = (v: typeof vehicle.$inferSelect) => ({
  ...v,
  capacityKwh: Number(v.capacityKwh),
  maxChargeKw: Number(v.maxChargeKw),
})

const memberOf = (workspaceId: string, userId: string) =>
  and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId))

export const residentsRepository = {
  documentOf: async (userId: string) =>
    (await db.select({ cpfCnpj: user.cpfCnpj }).from(user).where(eq(user.id, userId)).limit(1))[0]?.cpfCnpj ?? null,

  setDocument: (userId: string, cpfCnpj: string) => db.update(user).set({ cpfCnpj }).where(eq(user.id, userId)),

  // ---------- pessoas do condomínio ----------
  listMembers: (workspaceId: string) =>
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: workspaceMember.role,
        adminTitle: workspaceMember.adminTitle,
        kind: workspaceMember.kind,
        createdAt: user.createdAt,
        unitId: unit.id,
        unitLabel: unit.label,
        hasDocument: sql<boolean>`${user.cpfCnpj} is not null`,
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .leftJoin(unit, eq(unit.id, workspaceMember.unitId))
      .where(eq(workspaceMember.workspaceId, workspaceId))
      .orderBy(asc(user.name)),
  findUser: async (id: string) => (await db.select().from(user).where(eq(user.id, id)).limit(1))[0] ?? null,
  findMember: async (workspaceId: string, userId: string) =>
    (await db.select().from(workspaceMember).where(memberOf(workspaceId, userId)).limit(1))[0] ?? null,
  /** Em quantos condomínios a conta está. */
  membershipsCount: async (userId: string) =>
    (await db.select({ n: count() }).from(workspaceMember).where(eq(workspaceMember.userId, userId)))[0]?.n ?? 0,
  /** Quem ocupa o cargo (síndico/subsíndico) no condomínio. */
  titleHolder: async (workspaceId: string, title: 'SINDICO' | 'SUBSINDICO') =>
    (
      await db
        .select({ userId: workspaceMember.userId })
        .from(workspaceMember)
        .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.adminTitle, title)))
        .limit(1)
    )[0] ?? null,
  insertMember: (m: MemberValues) => db.insert(workspaceMember).values(m),
  updateMember: (workspaceId: string, userId: string, m: MemberPatch) =>
    db.update(workspaceMember).set(m).where(memberOf(workspaceId, userId)),
  removeMember: (workspaceId: string, userId: string) => db.delete(workspaceMember).where(memberOf(workspaceId, userId)),
  renameUser: (id: string, name: string) => db.update(user).set({ name }).where(eq(user.id, id)),
  /** Promoção a superadmin (seed): papel da conta e, sem uso para ele, os vínculos de admin. */
  setPlatformRole: (id: string, role: 'SUPER_ADMIN' | 'USER') => db.update(user).set({ role }).where(eq(user.id, id)),
  removeAdminMemberships: (userId: string) =>
    db.delete(workspaceMember).where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.role, 'ADMIN'))),

  /** Unidade e estação/carregador de casa da pessoa NESTE condomínio (unidade → estação → carregador). */
  homeOf: async (userId: string, workspaceId: string) =>
    (
      await db
        .select({
          unitId: unit.id,
          unitLabel: unit.label,
          stationId: station.id,
          stationName: station.name,
          stationAddress: station.address,
          chargerId: charger.id,
          chargerMaxPowerKw: charger.maxPowerKw,
        })
        .from(workspaceMember)
        .innerJoin(unit, eq(unit.id, workspaceMember.unitId))
        .leftJoin(station, eq(station.id, unit.stationId))
        .leftJoin(charger, eq(charger.stationId, station.id))
        .where(memberOf(workspaceId, userId))
        .limit(1)
    )[0] ?? null,

  // ---------- cartões RFID ----------
  /** Cartões de uma pessoa, ou dos moradores de um condomínio (convidado tem cartão no prédio dele). */
  listCards: (f: { userId?: string; workspaceId?: string }) => {
    let q = db
      .select({
        id: rfidCard.id,
        cardNumber: rfidCard.cardNumber,
        label: rfidCard.label,
        active: rfidCard.active,
        userId: rfidCard.userId,
        userName: user.name,
        createdAt: rfidCard.createdAt,
      })
      .from(rfidCard)
      .innerJoin(user, eq(user.id, rfidCard.userId))
      .$dynamic()
    if (f.workspaceId) {
      q = q.innerJoin(
        workspaceMember,
        and(
          eq(workspaceMember.userId, rfidCard.userId),
          eq(workspaceMember.workspaceId, f.workspaceId),
          eq(workspaceMember.kind, 'MORADOR'),
        ),
      )
    }
    return q.where(f.userId ? eq(rfidCard.userId, f.userId) : undefined).orderBy(asc(user.name))
  },
  findCard: async (id: string) => (await db.select().from(rfidCard).where(eq(rfidCard.id, id)).limit(1))[0] ?? null,
  createCard: async (c: CardInput) => (await db.insert(rfidCard).values(c).returning())[0]!,
  updateCard: async (id: string, c: Partial<CardInput>) =>
    (await db.update(rfidCard).set(c).where(eq(rfidCard.id, id)).returning())[0],
  removeCard: (id: string) => db.delete(rfidCard).where(eq(rfidCard.id, id)),

  // ---------- veículos ----------
  listVehicles: async (userId?: string) =>
    (
      await db
        .select()
        .from(vehicle)
        .where(userId ? eq(vehicle.userId, userId) : undefined)
        .orderBy(asc(vehicle.createdAt))
    ).map(toVehicle),
  findVehicle: async (id: string) => {
    const row = (await db.select().from(vehicle).where(eq(vehicle.id, id)).limit(1))[0]
    return row ? toVehicle(row) : null
  },
  createVehicle: async (userId: string, v: VehicleInput) =>
    toVehicle((await db.insert(vehicle).values({ userId, ...vehicleValues(v) } as typeof vehicle.$inferInsert).returning())[0]!),
  updateVehicle: async (id: string, v: Partial<VehicleInput>) =>
    toVehicle((await db.update(vehicle).set(vehicleValues(v)).where(eq(vehicle.id, id)).returning())[0]!),
  removeVehicle: (id: string) => db.delete(vehicle).where(eq(vehicle.id, id)),
}
