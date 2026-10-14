import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { station, unit, workspaceMember } from '../../infra/db/schema.js'

export type UnitInput = { label: string; stationId?: string | null }

export const unitsRepository = {
  list: (workspaceId: string) =>
    db
      .select({
        id: unit.id,
        label: unit.label,
        stationId: unit.stationId,
        stationName: station.name,
        residents: count(workspaceMember.userId),
      })
      .from(unit)
      .leftJoin(station, eq(station.id, unit.stationId))
      .leftJoin(workspaceMember, eq(workspaceMember.unitId, unit.id))
      .where(eq(unit.workspaceId, workspaceId))
      .groupBy(unit.id, station.name)
      .orderBy(asc(unit.label)),
  find: async (workspaceId: string, id: string) =>
    (await db.select().from(unit).where(and(eq(unit.workspaceId, workspaceId), eq(unit.id, id))).limit(1))[0] ?? null,
  create: async (workspaceId: string, u: UnitInput) => (await db.insert(unit).values({ ...u, workspaceId }).returning())[0]!,
  update: async (workspaceId: string, id: string, u: Partial<UnitInput>) =>
    (await db.update(unit).set(u).where(and(eq(unit.workspaceId, workspaceId), eq(unit.id, id))).returning())[0],
  remove: (id: string) => db.delete(unit).where(eq(unit.id, id)),
}
