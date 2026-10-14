import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { charger, reservation, station, vehicle } from '../../infra/db/schema.js'

/**
 * Início efetivo pra checar conflito: se o carro já estava plugado antes do horário escolhido
 * (`occupiedFromAt`), o carregador fica bloqueado pra outros desde então — não só a partir de
 * `startsAt` (que continua sendo só a janela de carga, pra preço/energia).
 */
const effectiveStart = sql`coalesce(${reservation.occupiedFromAt}, ${reservation.startsAt})`

export type NewReservation = typeof reservation.$inferInsert
export type NewPendingReservation = { userId: string; chargerId: string; vehicleId: string; targetSoc: number; deadlineAt: Date }
export type Resolution = {
  startsAt: Date
  endsAt: Date
  startSoc: number
  energyKwh: string
  estimatedCostCents: number | null
  deadlineAt?: Date
}

const toDto = (r: typeof reservation.$inferSelect) => ({ ...r, energyKwh: r.energyKwh === null ? null : Number(r.energyKwh) })

export const reservationsRepository = {
  /** Janelas já ocupadas (SCHEDULED) do carregador — reservas PENDING_PLUGIN não têm horário. */
  overlapping: async (chargerId: string, from: Date, to: Date, excludeId?: string) => {
    const rows = await db
      .select({
        id: reservation.id,
        userId: reservation.userId,
        startsAt: reservation.startsAt,
        endsAt: reservation.endsAt,
        occupiedFromAt: reservation.occupiedFromAt,
      })
      .from(reservation)
      .where(
        and(
          eq(reservation.chargerId, chargerId),
          eq(reservation.status, 'SCHEDULED'),
          lt(effectiveStart, to),
          gt(reservation.endsAt, from),
          excludeId ? ne(reservation.id, excludeId) : undefined,
        ),
      )
      .orderBy(asc(reservation.startsAt))
    // status='SCHEDULED' garante startsAt/endsAt preenchidos (só PENDING_PLUGIN fica sem horário).
    return rows.map((r) => ({ ...r, startsAt: r.occupiedFromAt ?? r.startsAt!, endsAt: r.endsAt! }))
  },

  /** Reservas do morador com o carro e o local (nome, endereço e tipo da estação). */
  ofUser: async (userId: string, limit = 20) =>
    (
      await db
        .select({
          r: reservation,
          vehicleModel: vehicle.model,
          stationName: station.name,
          stationAddress: station.address,
          stationKind: station.kind,
        })
        .from(reservation)
        .leftJoin(vehicle, eq(vehicle.id, reservation.vehicleId))
        .leftJoin(charger, eq(charger.id, reservation.chargerId))
        .leftJoin(station, eq(station.id, charger.stationId))
        .where(eq(reservation.userId, userId))
        .orderBy(desc(reservation.createdAt))
        .limit(limit)
    ).map(({ r, ...rest }) => ({ ...toDto(r), ...rest })),

  /** Cria com horário (fluxo "já plugado" ou reserva por horário de início) só se continuar livre. */
  createIfFree: (r: NewReservation) =>
    db.transaction(
      async (tx) => {
        const clash = await tx
          .select({ id: reservation.id })
          .from(reservation)
          .where(
            and(
              eq(reservation.chargerId, r.chargerId),
              eq(reservation.status, 'SCHEDULED'),
              lt(effectiveStart, r.endsAt!),
              gt(reservation.endsAt, r.occupiedFromAt ?? r.startsAt!),
            ),
          )
          .limit(1)
        if (clash.length) return null
        return toDto((await tx.insert(reservation).values(r).returning())[0]!)
      },
      { isolationLevel: 'serializable' },
    ),

  /** Cria a regra "meta % + prazo" sem horário — fluxo "agendar pra depois". */
  createPending: async (r: NewPendingReservation) =>
    toDto(
      (
        await db
          .insert(reservation)
          .values({ ...r, status: 'PENDING_PLUGIN' })
          .returning()
      )[0]!,
    ),

  /** A regra pendente mais antiga do usuário nesse carregador, se houver. */
  pendingForUser: async (userId: string, chargerId: string) =>
    (
      await db
        .select()
        .from(reservation)
        .where(and(eq(reservation.userId, userId), eq(reservation.chargerId, chargerId), eq(reservation.status, 'PENDING_PLUGIN')))
        .orderBy(asc(reservation.createdAt))
        .limit(1)
    )[0] ?? null,

  /**
   * A reserva por horário ainda sem bateria lida (SCHEDULED com `startSoc` nulo) que esse
   * plugue atende: a mais cedo que ainda não acabou e começa em até `withinMs` a partir de agora.
   */
  provisionalForUser: async (userId: string, chargerId: string, now: Date, withinMs: number) =>
    (
      await db
        .select()
        .from(reservation)
        .where(
          and(
            eq(reservation.userId, userId),
            eq(reservation.chargerId, chargerId),
            eq(reservation.status, 'SCHEDULED'),
            isNull(reservation.startSoc),
            gt(reservation.endsAt, now),
            lt(reservation.startsAt, new Date(now.getTime() + withinMs)),
          ),
        )
        .orderBy(asc(reservation.startsAt))
        .limit(1)
    )[0] ?? null,

  /**
   * Fixa o horário real de uma reserva (regra pendente ou reserva provisória), só se continuar
   * livre no mesmo carregador (mesma checagem do createIfFree).
   */
  resolve: (id: string, chargerId: string, res: Resolution) =>
    db.transaction(
      async (tx) => {
        const clash = await tx
          .select({ id: reservation.id })
          .from(reservation)
          .where(
            and(
              eq(reservation.chargerId, chargerId),
              eq(reservation.status, 'SCHEDULED'),
              ne(reservation.id, id),
              lt(effectiveStart, res.endsAt),
              gt(reservation.endsAt, res.startsAt),
            ),
          )
          .limit(1)
        if (clash.length) return false
        await tx.update(reservation).set({ ...res, status: 'SCHEDULED' }).where(eq(reservation.id, id))
        return true
      },
      { isolationLevel: 'serializable' },
    ),

  /** Regras pendentes cujo prazo já passou sem o carro plugar → EXPIRED. */
  expireOverdue: (now: Date) =>
    db
      .update(reservation)
      .set({ status: 'EXPIRED' })
      .where(and(eq(reservation.status, 'PENDING_PLUGIN'), lt(reservation.deadlineAt, now))),

  findById: async (id: string) => (await db.select().from(reservation).where(eq(reservation.id, id)).limit(1))[0] ?? null,
  cancel: (id: string) => db.update(reservation).set({ status: 'CANCELLED' }).where(eq(reservation.id, id)),
  expire: (id: string) => db.update(reservation).set({ status: 'EXPIRED' }).where(eq(reservation.id, id)),
}
