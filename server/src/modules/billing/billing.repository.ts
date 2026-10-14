import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { cycleEntry, invoice, unit, user, workspaceMember } from '../../infra/db/schema.js'

export type NewInvoice = typeof invoice.$inferInsert
export type NewCycleEntry = typeof cycleEntry.$inferInsert

export const billingRepository = {
  /** Pessoas do condomínio com a unidade e o tipo de vínculo (quem pode receber fatura). */
  people: (workspaceId: string) =>
    db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        kind: workspaceMember.kind,
        unitLabel: unit.label,
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .leftJoin(unit, eq(unit.id, workspaceMember.unitId))
      .where(eq(workspaceMember.workspaceId, workspaceId)),

  /** Ciclos com fatura emitida ("2026-09"): as sessões deles ficam congeladas. */
  closedPeriods: async (workspaceId: string) =>
    new Set(
      (await db.selectDistinct({ period: invoice.period }).from(invoice).where(eq(invoice.workspaceId, workspaceId))).map(
        (r) => r.period,
      ),
    ),

  invoicesOf: (workspaceId: string, period: string) =>
    db.select().from(invoice).where(and(eq(invoice.workspaceId, workspaceId), eq(invoice.period, period))),

  /** Lançamentos do gestor no ciclo, com o nome de quem recebe o ajuste. */
  entriesOf: (workspaceId: string, period: string) =>
    db
      .select({
        id: cycleEntry.id,
        kind: cycleEntry.kind,
        description: cycleEntry.description,
        amountCents: cycleEntry.amountCents,
        userId: cycleEntry.userId,
        userName: user.name,
        createdAt: cycleEntry.createdAt,
      })
      .from(cycleEntry)
      .leftJoin(user, eq(user.id, cycleEntry.userId))
      .where(and(eq(cycleEntry.workspaceId, workspaceId), eq(cycleEntry.period, period)))
      .orderBy(asc(cycleEntry.createdAt)),

  insertEntry: (row: NewCycleEntry) => db.insert(cycleEntry).values(row),

  findEntry: async (id: string) => (await db.select().from(cycleEntry).where(eq(cycleEntry.id, id)).limit(1))[0] ?? null,

  deleteEntry: (id: string) => db.delete(cycleEntry).where(eq(cycleEntry.id, id)),

  findInvoice: async (id: string) => (await db.select().from(invoice).where(eq(invoice.id, id)).limit(1))[0] ?? null,

  replacePending: (workspaceId: string, period: string, rows: NewInvoice[]) =>
    db.transaction(async (tx) => {
      await tx
        .delete(invoice)
        .where(and(eq(invoice.workspaceId, workspaceId), eq(invoice.period, period), eq(invoice.status, 'PENDING')))
      if (rows.length) await tx.insert(invoice).values(rows)
    }),

  setStatus: (id: string, status: 'PENDING' | 'PAID') =>
    db
      .update(invoice)
      .set({ status, paidAt: status === 'PAID' ? new Date() : null })
      .where(eq(invoice.id, id))
      .returning(),
}
