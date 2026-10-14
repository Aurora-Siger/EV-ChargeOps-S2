import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { charger, chargeSession, rfidCard, station, unit, user, workspaceMember } from '../../infra/db/schema.js'
import type { MappedSession } from './sessions.mapper.js'

export type SessionFilter = {
  /** Só sessões dos carregadores deste condomínio. */
  workspaceId?: string
  start?: Date
  end?: Date
  userId?: string
  unassigned?: boolean
  limit?: number
}

const n = (v: string | null) => (v === null ? null : Number(v))

export const sessionsRepository = {
  activeCards: () =>
    db.select({ cardNumber: rfidCard.cardNumber, userId: rfidCard.userId }).from(rfidCard).where(eq(rfidCard.active, true)),

  /**
   * Upsert pela serial da SEMS. Nunca sobrescreve um morador atribuído à mão pelo gestor, e
   * a tarifa base fica congelada na primeira vez que a sessão entra (mudar a tarifa depois
   * não reprecifica o passado).
   */
  upsertFromSems: (rows: (MappedSession & { chargerId: string; userId: string | null; tariffBaseCentsKwh: number | null })[]) =>
    db.transaction(async (tx) => {
      for (const r of rows) {
        await tx
          .insert(chargeSession)
          .values({
            serial: r.serial,
            chargerId: r.chargerId,
            userId: r.userId,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            energyKwh: String(r.energyKwh),
            greenKwh: r.greenKwh === null ? null : String(r.greenKwh),
            gridKwh: r.gridKwh === null ? null : String(r.gridKwh),
            durationMin: r.durationMin,
            mileageKm: r.mileageKm === null ? null : String(r.mileageKm),
            cardNumber: r.cardNumber,
            endCause: r.endCause,
            tariffBaseCentsKwh: r.tariffBaseCentsKwh,
          })
          .onConflictDoUpdate({
            target: chargeSession.serial,
            set: {
              startedAt: r.startedAt,
              endedAt: r.endedAt,
              energyKwh: String(r.energyKwh),
              greenKwh: r.greenKwh === null ? null : String(r.greenKwh),
              gridKwh: r.gridKwh === null ? null : String(r.gridKwh),
              durationMin: r.durationMin,
              mileageKm: r.mileageKm === null ? null : String(r.mileageKm),
              cardNumber: r.cardNumber,
              endCause: r.endCause,
              userId: sql`CASE WHEN ${chargeSession.assignedManually} THEN ${chargeSession.userId}
                ELSE COALESCE(excluded.user_id, ${chargeSession.userId}) END`,
              tariffBaseCentsKwh: sql`COALESCE(${chargeSession.tariffBaseCentsKwh}, excluded.tariff_base_cents_kwh)`,
            },
          })
      }
    }),

  forPricing: (chargerId: string) =>
    db
      .select({
        id: chargeSession.id,
        startedAt: chargeSession.startedAt,
        endedAt: chargeSession.endedAt,
        durationMin: chargeSession.durationMin,
        energyKwh: chargeSession.energyKwh,
        idleMin: chargeSession.idleMin,
        tariffBaseCentsKwh: chargeSession.tariffBaseCentsKwh,
        demand: chargeSession.demand,
        mult: chargeSession.mult,
        energyCostCents: chargeSession.energyCostCents,
        priceCents: chargeSession.priceCents,
      })
      .from(chargeSession)
      .where(eq(chargeSession.chargerId, chargerId))
      .orderBy(asc(chargeSession.startedAt)),

  updatePricing: (id: string, v: { demand: number; mult: number; energyCostCents: number | null; priceCents: number | null }) =>
    db
      .update(chargeSession)
      .set({ demand: String(v.demand), mult: String(v.mult), energyCostCents: v.energyCostCents, priceCents: v.priceCents })
      .where(eq(chargeSession.id, id)),

  setIdle: (id: string, idleMin: number) => db.update(chargeSession).set({ idleMin }).where(eq(chargeSession.id, id)),

  intervals: (chargerId: string) =>
    db
      .select({ start: chargeSession.startedAt, end: chargeSession.endedAt, durationMin: chargeSession.durationMin })
      .from(chargeSession)
      .where(eq(chargeSession.chargerId, chargerId)),

  list: async (f: SessionFilter) => {
    const where: SQL[] = []
    if (f.start) where.push(gte(chargeSession.startedAt, f.start))
    if (f.end) where.push(lt(chargeSession.startedAt, f.end))
    if (f.userId) where.push(eq(chargeSession.userId, f.userId))
    if (f.unassigned) where.push(isNull(chargeSession.userId))
    if (f.workspaceId) where.push(eq(station.workspaceId, f.workspaceId))
    const q = db
      .select({
        id: chargeSession.id,
        chargerId: chargeSession.chargerId,
        startedAt: chargeSession.startedAt,
        endedAt: chargeSession.endedAt,
        energyKwh: chargeSession.energyKwh,
        greenKwh: chargeSession.greenKwh,
        gridKwh: chargeSession.gridKwh,
        durationMin: chargeSession.durationMin,
        mileageKm: chargeSession.mileageKm,
        cardNumber: chargeSession.cardNumber,
        idleMin: chargeSession.idleMin,
        demand: chargeSession.demand,
        mult: chargeSession.mult,
        energyCostCents: chargeSession.energyCostCents,
        chargedCents: chargeSession.priceCents,
        tariffBaseCentsKwh: chargeSession.tariffBaseCentsKwh,
        assignedManually: chargeSession.assignedManually,
        userId: chargeSession.userId,
        userName: user.name,
        unitLabel: unit.label,
        memberKind: workspaceMember.kind,
      })
      .from(chargeSession)
      .innerJoin(charger, eq(charger.id, chargeSession.chargerId))
      .innerJoin(station, eq(station.id, charger.stationId))
      .leftJoin(user, eq(user.id, chargeSession.userId))
      // unidade e tipo (morador/convidado) da pessoa no condomínio onde a sessão aconteceu
      .leftJoin(
        workspaceMember,
        and(eq(workspaceMember.userId, chargeSession.userId), eq(workspaceMember.workspaceId, station.workspaceId)),
      )
      .leftJoin(unit, eq(unit.id, workspaceMember.unitId))
      .where(and(...where))
      .orderBy(desc(chargeSession.startedAt))
    const rows = await (f.limit ? q.limit(f.limit) : q)
    return rows.map((r) => ({
      ...r,
      energyKwh: n(r.energyKwh) ?? 0,
      greenKwh: n(r.greenKwh),
      gridKwh: n(r.gridKwh),
      mileageKm: n(r.mileageKm),
      demand: n(r.demand),
      mult: n(r.mult),
    }))
  },

  /** Sessão com o condomínio do carregador onde aconteceu. */
  findById: async (id: string) =>
    (
      await db
        .select({ session: chargeSession, workspaceId: station.workspaceId })
        .from(chargeSession)
        .innerJoin(charger, eq(charger.id, chargeSession.chargerId))
        .innerJoin(station, eq(station.id, charger.stationId))
        .where(eq(chargeSession.id, id))
        .limit(1)
    )[0] ?? null,

  assign: (id: string, userId: string | null) =>
    db.update(chargeSession).set({ userId, assignedManually: true }).where(eq(chargeSession.id, id)),
}
