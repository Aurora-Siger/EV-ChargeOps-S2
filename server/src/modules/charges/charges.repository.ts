import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { invoice, paymentCharge, paymentEvent, unit, user, workspace, workspaceMember } from '../../infra/db/schema.js'

export type ChargeRow = typeof paymentCharge.$inferSelect
export type NewCharge = typeof paymentCharge.$inferInsert

export const chargesRepository = {
  find: async (id: string) => (await db.select().from(paymentCharge).where(eq(paymentCharge.id, id)).limit(1))[0] ?? null,

  findByExternalId: async (provider: string, externalId: string) =>
    (
      await db
        .select()
        .from(paymentCharge)
        .where(and(eq(paymentCharge.provider, provider), eq(paymentCharge.externalId, externalId)))
        .limit(1)
    )[0] ?? null,

  /** Condomínio da fatura da cobrança. */
  workspaceOf: async (chargeId: string) =>
    (
      await db
        .select({ workspaceId: invoice.workspaceId })
        .from(paymentCharge)
        .innerJoin(invoice, eq(invoice.id, paymentCharge.invoiceId))
        .where(eq(paymentCharge.id, chargeId))
        .limit(1)
    )[0]?.workspaceId ?? null,

  /** Fatura com nome e e-mail do pagador e o nome do condomínio (quem recebe). */
  invoiceWithPayer: async (invoiceId: string) =>
    (
      await db
        .select({ invoice, name: user.name, email: user.email, cpfCnpj: user.cpfCnpj, workspaceName: workspace.name })
        .from(invoice)
        .innerJoin(user, eq(user.id, invoice.userId))
        .innerJoin(workspace, eq(workspace.id, invoice.workspaceId))
        .where(eq(invoice.id, invoiceId))
        .limit(1)
    )[0] ?? null,

  pendingInvoicesOf: (workspaceId: string, period: string) =>
    db
      .select()
      .from(invoice)
      .where(and(eq(invoice.workspaceId, workspaceId), eq(invoice.period, period), eq(invoice.status, 'PENDING'))),

  ofInvoice: (invoiceId: string) =>
    db.select().from(paymentCharge).where(eq(paymentCharge.invoiceId, invoiceId)).orderBy(desc(paymentCharge.createdAt)),

  activeOf: (invoiceIds: string[]) =>
    invoiceIds.length
      ? db
          .select()
          .from(paymentCharge)
          .where(and(inArray(paymentCharge.invoiceId, invoiceIds), eq(paymentCharge.status, 'PENDING')))
      : Promise.resolve([] as ChargeRow[]),

  /** Todas as cobranças das faturas do ciclo do condomínio, com quem paga. */
  ofPeriod: (workspaceId: string, period: string) =>
    db
      .select({ charge: paymentCharge, name: user.name, unitLabel: unit.label })
      .from(paymentCharge)
      .innerJoin(invoice, eq(invoice.id, paymentCharge.invoiceId))
      .innerJoin(user, eq(user.id, paymentCharge.userId))
      .leftJoin(
        workspaceMember,
        and(eq(workspaceMember.userId, user.id), eq(workspaceMember.workspaceId, invoice.workspaceId)),
      )
      .leftJoin(unit, eq(unit.id, workspaceMember.unitId))
      .where(and(eq(invoice.workspaceId, workspaceId), eq(invoice.period, period)))
      .orderBy(desc(paymentCharge.createdAt)),

  /** Guarda o evento do webhook; false se já tinha sido recebido (reenvio do provedor). */
  recordEvent: async (chargeId: string, provider: string, eventId: string, kind: string) =>
    (
      await db
        .insert(paymentEvent)
        .values({ chargeId, provider, eventId, kind })
        .onConflictDoNothing()
        .returning({ id: paymentEvent.id })
    ).length > 0,

  /** Eventos recebidos do provedor para as cobranças do ciclo, mais recentes primeiro. */
  eventsOfPeriod: (workspaceId: string, period: string, limit: number) =>
    db
      .select({ chargeId: paymentEvent.chargeId, kind: paymentEvent.kind, at: paymentEvent.createdAt })
      .from(paymentEvent)
      .innerJoin(paymentCharge, eq(paymentCharge.id, paymentEvent.chargeId))
      .innerJoin(invoice, eq(invoice.id, paymentCharge.invoiceId))
      .where(and(eq(invoice.workspaceId, workspaceId), eq(invoice.period, period)))
      .orderBy(desc(paymentEvent.createdAt))
      .limit(limit),

  insert: async (row: NewCharge) => (await db.insert(paymentCharge).values(row).returning())[0]!,

  cancel: (ids: string[]) =>
    ids.length
      ? db.update(paymentCharge).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(inArray(paymentCharge.id, ids))
      : Promise.resolve(),

  /** Baixa: a cobrança paga vira RECEIVED, as outras abertas da fatura caem e a fatura fica paga. */
  settle: (charge: ChargeRow, paidAt: Date) =>
    db.transaction(async (tx) => {
      await tx.update(paymentCharge).set({ status: 'RECEIVED', paidAt }).where(eq(paymentCharge.id, charge.id))
      await tx
        .update(paymentCharge)
        .set({ status: 'CANCELLED', cancelledAt: paidAt })
        .where(
          and(
            eq(paymentCharge.invoiceId, charge.invoiceId),
            eq(paymentCharge.status, 'PENDING'),
            ne(paymentCharge.id, charge.id),
          ),
        )
      await tx.update(invoice).set({ status: 'PAID', paidAt }).where(eq(invoice.id, charge.invoiceId))
    }),

  receivedOf: (invoiceId: string) =>
    db.select().from(paymentCharge).where(and(eq(paymentCharge.invoiceId, invoiceId), eq(paymentCharge.status, 'RECEIVED'))),

  markRefunded: (ids: string[]) =>
    ids.length ? db.update(paymentCharge).set({ status: 'REFUNDED' }).where(inArray(paymentCharge.id, ids)) : Promise.resolve(),
}
