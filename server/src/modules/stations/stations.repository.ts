import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { charger, rfidCard, station, user } from '../../infra/db/schema.js'

export type StationInput = {
  name: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  kind?: 'CONDOMINIO' | 'PARCEIRO' | 'PUBLICO'
  openingHours?: string | null
  publicPriceCentsKwh?: number | null
  imageUrl?: string | null
  workspaceId?: string | null
}

// Só o repository fala com o Drizzle. Service nunca monta query.
export const stationsRepository = {
  ownerOfCard: async (cardNumber: string) =>
    (
      await db
        .select({ id: user.id, name: user.name })
        .from(rfidCard)
        .innerJoin(user, eq(user.id, rfidCard.userId))
        .where(and(eq(rfidCard.cardNumber, cardNumber), eq(rfidCard.active, true)))
        .limit(1)
    )[0] ?? null,

  list: () =>
    db.query.station.findMany({ with: { chargers: true, workspace: true }, orderBy: (s, { asc }) => asc(s.name) }),
  findById: (id: string) =>
    db.query.station.findFirst({ where: eq(station.id, id), with: { chargers: true } }),

  chargerByExternalId: async (externalId: string) =>
    (await db.select().from(charger).where(eq(charger.externalId, externalId)).limit(1))[0] ?? null,
  chargerById: async (id: string) => (await db.select().from(charger).where(eq(charger.id, id)).limit(1))[0] ?? null,
  chargerWithStation: async (id: string) =>
    (
      await db
        .select({ charger, station })
        .from(charger)
        .innerJoin(station, eq(station.id, charger.stationId))
        .where(eq(charger.id, id))
        .limit(1)
    )[0] ?? null,
  /** Carregadores do condomínio, o que tem telemetria (external_id) primeiro. */
  condoChargersOf: (workspaceId: string) =>
    db
      .select({ id: charger.id, externalId: charger.externalId })
      .from(charger)
      .innerJoin(station, eq(station.id, charger.stationId))
      .where(and(eq(station.workspaceId, workspaceId), eq(station.kind, 'CONDOMINIO')))
      .orderBy(sql`${charger.externalId} IS NULL`, asc(station.createdAt)),
  firstCondoChargerWithoutExternalId: async () =>
    (
      await db
        .select({ id: charger.id })
        .from(charger)
        .innerJoin(station, eq(station.id, charger.stationId))
        .where(and(eq(station.kind, 'CONDOMINIO'), isNull(charger.externalId)))
        .orderBy(asc(station.createdAt))
        .limit(1)
    )[0] ?? null,
  setChargerExternalId: (id: string, externalId: string) =>
    db.update(charger).set({ externalId }).where(eq(charger.id, id)),

  create: (s: StationInput, maxPowerKw: number, externalId?: string) =>
    db.transaction(async (tx) => {
      const [st] = await tx.insert(station).values(s).returning()
      const [ch] = await tx
        .insert(charger)
        .values({ stationId: st!.id, maxPowerKw: String(maxPowerKw), connector: 'Type 2', externalId })
        .returning()
      return { station: st!, charger: ch! }
    }),
  update: (id: string, s: Partial<StationInput>, maxPowerKw?: number) =>
    db.transaction(async (tx) => {
      if (Object.keys(s).length) await tx.update(station).set(s).where(eq(station.id, id))
      if (maxPowerKw !== undefined) await tx.update(charger).set({ maxPowerKw: String(maxPowerKw) }).where(eq(charger.stationId, id))
    }),
  remove: (id: string) => db.delete(station).where(eq(station.id, id)),
}
