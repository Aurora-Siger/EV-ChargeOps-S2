import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { semsChargeLog, semsPowerPoint, semsSnapshot, type semsSnapshotKind } from '../../infra/db/schema.js'
import type { PowerPoint } from './domain/power.js'

type Kind = (typeof semsSnapshotKind.enumValues)[number]

export const semsRepository = {
  saveSnapshot: (kind: Kind, payload: unknown) =>
    db.insert(semsSnapshot).values({ kind, payload: payload as object }),

  latestSnapshot: async (kind: Kind) => {
    const [row] = await db
      .select({ collectedAt: semsSnapshot.collectedAt, payload: semsSnapshot.payload })
      .from(semsSnapshot)
      .where(eq(semsSnapshot.kind, kind))
      .orderBy(desc(semsSnapshot.collectedAt))
      .limit(1)
    return row ?? null
  },

  history: (kind: Kind, limit: number) =>
    db
      .select({ collectedAt: semsSnapshot.collectedAt, payload: semsSnapshot.payload })
      .from(semsSnapshot)
      .where(eq(semsSnapshot.kind, kind))
      .orderBy(desc(semsSnapshot.collectedAt))
      .limit(limit)
      .then((rows) => rows.reverse()),

  /** Série de status (só o que diz se o cabo está no carro), em ordem cronológica. */
  /** Estado do cabo em cada poll, em ordem; `since` corta o que nenhuma sessão em aberto usa. */
  plugStates: (since: Date | null = null) =>
    db
      .select({
        collectedAt: semsSnapshot.collectedAt,
        workState: sql<string | null>`${semsSnapshot.payload}->>'workState'`,
        status: sql<string | null>`${semsSnapshot.payload}->>'status'`,
        vehConnStu: sql<number | null>`(${semsSnapshot.payload}->>'vehConnStu')::int`,
      })
      .from(semsSnapshot)
      .where(and(eq(semsSnapshot.kind, 'detail'), since ? gt(semsSnapshot.collectedAt, since) : undefined))
      .orderBy(asc(semsSnapshot.collectedAt)),

  upsertChargeLogEntries: async (entries: { serial: string; payload: object }[]) => {
    if (entries.length === 0) return
    for (const entry of entries) {
      await db
        .insert(semsChargeLog)
        .values({ serial: entry.serial, payload: entry.payload })
        .onConflictDoUpdate({
          target: semsChargeLog.serial,
          set: { payload: entry.payload, updatedAt: sql`now()` },
        })
    }
  },

  chargeLog: (limit: number) =>
    db
      .select({ payload: semsChargeLog.payload })
      .from(semsChargeLog)
      .orderBy(desc(sql`(${semsChargeLog.payload}->>'chargeStartTime')`))
      .limit(limit),

  /** Grava os pontos da série de potência; reler a mesma janela só atualiza o valor. */
  upsertPowerPoints: async (sn: string, points: PowerPoint[]) => {
    if (points.length === 0) return
    await db
      .insert(semsPowerPoint)
      .values(points.map((p) => ({ sn, at: p.at, kw: p.kw })))
      .onConflictDoUpdate({ target: [semsPowerPoint.sn, semsPowerPoint.at], set: { kw: sql`excluded.kw` } })
  },

  latestPower: async (sn: string): Promise<PowerPoint | null> =>
    (
      await db
        .select({ at: semsPowerPoint.at, kw: semsPowerPoint.kw })
        .from(semsPowerPoint)
        .where(eq(semsPowerPoint.sn, sn))
        .orderBy(desc(semsPowerPoint.at))
        .limit(1)
    )[0] ?? null,

  /** Dias (horário de Brasília, "AAAA-MM-DD") que já têm algum ponto de potência gravado. */
  powerDays: async (sn: string): Promise<Set<string>> =>
    new Set(
      (
        await db
          .selectDistinct({ day: sql<string>`to_char(${semsPowerPoint.at} - interval '3 hours', 'YYYY-MM-DD')` })
          .from(semsPowerPoint)
          .where(eq(semsPowerPoint.sn, sn))
      ).map((r) => r.day),
    ),

  /** Início da recarga mais antiga do log ("AAAA-MM-DD HH:MM:SS", horário local), ou null. */
  firstChargeStart: async () =>
    (
      await db
        .select({ start: sql<string | null>`min(${semsChargeLog.payload}->>'chargeStartTime')` })
        .from(semsChargeLog)
    )[0]?.start ?? null,

  /** Todo o log de sessões (volume pequeno: uma linha por recarga), para a ingestão em charge_session. */
  allChargeLog: () => db.select({ serial: semsChargeLog.serial, payload: semsChargeLog.payload }).from(semsChargeLog),
}
