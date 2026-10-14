import QRCode from 'qrcode'
import type { ChargeMethod } from '../../infra/payments/gateway.js'
import { activeGateway as gateway, gatewayOf } from '../../infra/payments/index.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { localDate } from '../../shared/time.js'
import { chargesRepository, type ChargeRow } from './charges.repository.js'

export type ChargeState = 'PENDING' | 'OVERDUE' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED'


const stateOf = (c: ChargeRow): ChargeState =>
  c.status === 'PENDING' && c.dueDate < localDate() ? 'OVERDUE' : c.status

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const periodName = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return `${MONTHS[m - 1]}/${y}`
}

/** Cobrança como o front vê. O QR do Pix (PNG em base64) só vai quando pedido: custa gerar. */
async function toDto(c: ChargeRow, withQr = false) {
  const state = stateOf(c)
  return {
    id: c.id,
    invoiceId: c.invoiceId,
    provider: c.provider,
    externalId: c.externalId,
    method: c.method,
    status: state,
    amountCents: c.amountCents,
    dueDate: c.dueDate,
    pix: c.pixPayload
      ? {
          payload: c.pixPayload,
          expiresAt: c.pixExpiresAt,
          qrCodeImage:
            withQr && state === 'PENDING' ? await QRCode.toDataURL(c.pixPayload, { margin: 1, width: 280 }) : null,
        }
      : null,
    boleto: c.boletoDigitableLine
      ? { digitableLine: c.boletoDigitableLine, barcode: c.boletoBarcode!, nossoNumero: c.boletoNossoNumero! }
      : null,
    canSimulatePayment: gateway.canSimulatePayment && c.provider === gateway.provider,
    paidAt: c.paidAt,
    cancelledAt: c.cancelledAt,
    createdAt: c.createdAt,
  }
}

export type ChargeDto = Awaited<ReturnType<typeof toDto>>

/**
 * Quem pode mexer na cobrança/fatura: `ownerId` restringe ao dono (rotas do morador),
 * `workspaceId` ao condomínio ativo (painel do gestor).
 */
export type ChargeScope = { ownerId?: string; workspaceId?: string }

async function owned(chargeId: string, scope: ChargeScope) {
  const c = await chargesRepository.find(chargeId)
  if (!c) throw new NotFoundError('Cobrança')
  if (scope.ownerId && c.userId !== scope.ownerId) throw new ForbiddenError()
  if (scope.workspaceId && (await chargesRepository.workspaceOf(chargeId)) !== scope.workspaceId) {
    throw new NotFoundError('Cobrança')
  }
  return c
}

/**
 * Dá baixa na cobrança paga e cancela, também no provedor, as outras em aberto da mesma
 * fatura (o Pix pago derruba o boleto). Sem isso o boleto seguiria pagável no Asaas.
 */
async function settle(c: ChargeRow) {
  const others = (await chargesRepository.activeOf([c.invoiceId])).filter((o) => o.id !== c.id)
  await chargesRepository.settle(c, new Date())
  for (const o of others) {
    try {
      await gatewayOf(o.provider).cancelCharge(o.externalId)
    } catch (e) {
      console.error(`[cobranca] não cancelou ${o.externalId} no provedor após o pagamento de ${c.externalId}:`, e)
    }
  }
}

export const chargesService = {
  /** Cobranças de uma fatura, mais recentes primeiro (com QR nas de Pix em aberto). */
  async ofInvoice(invoiceId: string, scope: ChargeScope = {}) {
    if (scope.workspaceId || scope.ownerId) {
      const found = await chargesRepository.invoiceWithPayer(invoiceId)
      if (
        !found ||
        (scope.workspaceId && found.invoice.workspaceId !== scope.workspaceId) ||
        (scope.ownerId && found.invoice.userId !== scope.ownerId)
      ) {
        throw new NotFoundError('Fatura')
      }
    }
    const rows = await chargesRepository.ofInvoice(invoiceId)
    return Promise.all(rows.map((c) => toDto(c, true)))
  },

  /** Gera (ou devolve a que já está aberta) a cobrança da fatura na forma pedida. */
  async issue(invoiceId: string, method: ChargeMethod, scope: ChargeScope) {
    const found = await chargesRepository.invoiceWithPayer(invoiceId)
    if (!found) throw new NotFoundError('Fatura')
    const { invoice, name, email, cpfCnpj, workspaceName } = found
    if (scope.workspaceId && invoice.workspaceId !== scope.workspaceId) throw new NotFoundError('Fatura')
    if (scope.ownerId && invoice.userId !== scope.ownerId) throw new ForbiddenError()
    if (invoice.status === 'PAID') throw new AppError('Esta fatura já está paga', 409, 'CONFLICT')
    if (invoice.totalCents <= 0) throw new AppError('Fatura sem valor a cobrar', 400, 'VALIDATION')

    const open = (await chargesRepository.activeOf([invoiceId])).find((c) => c.method === method)
    // Vencida, a cobrança nova vence hoje. Uma aberta que já passou do vencimento é trocada.
    const today = localDate()
    if (open && open.dueDate >= today) return toDto(open, true)
    if (open) {
      await gatewayOf(open.provider).cancelCharge(open.externalId)
      await chargesRepository.cancel([open.id])
    }

    const dueDate = invoice.dueDate < today ? today : invoice.dueDate
    // Gestor emitindo: o CPF que falta é do morador, e quem informa é ele mesmo (Perfil).
    if (scope.workspaceId && !cpfCnpj && gateway.requiresDocument) {
      throw new AppError(
        `${name} ainda não informou o CPF/CNPJ. Peça pra ele preencher em Perfil → Dados de cobrança.`,
        422,
        'MISSING_DOCUMENT',
      )
    }
    const created = await gateway.createCharge({
      method,
      amountCents: invoice.totalCents,
      dueDate,
      description: `Recarga EV ${periodName(invoice.period)}${invoice.unitLabel ? ` ${invoice.unitLabel}` : ''}`,
      externalReference: invoice.id,
      customer: { id: invoice.userId, name, email, cpfCnpj },
      merchant: { name: workspaceName, city: 'Sao Paulo' },
    })
    const row = await chargesRepository.insert({
      invoiceId,
      userId: invoice.userId,
      provider: gateway.provider,
      externalId: created.externalId,
      method,
      amountCents: invoice.totalCents,
      dueDate,
      pixPayload: created.pix?.payload,
      pixExpiresAt: created.pix?.expiresAt,
      boletoDigitableLine: created.boleto?.digitableLine,
      boletoBarcode: created.boleto?.barcode,
      boletoNossoNumero: created.boleto?.nossoNumero,
    })
    return toDto(row, true)
  },

  /** Emite a cobrança de todas as faturas pendentes do ciclo que ainda não têm uma nessa forma. */
  async issueForCycle(workspaceId: string, period: string, method: ChargeMethod) {
    const invoices = await chargesRepository.pendingInvoicesOf(workspaceId, period)
    const active = await chargesRepository.activeOf(invoices.map((i) => i.id))
    const covered = new Set(active.filter((c) => c.method === method).map((c) => c.invoiceId))
    let issued = 0
    // Sem CPF/CNPJ o provedor não emite: pula esse morador e segue com os demais, avisando quem faltou.
    const skipped: string[] = []
    for (const inv of invoices) {
      if (covered.has(inv.id) || inv.totalCents <= 0) continue
      try {
        await chargesService.issue(inv.id, method, { workspaceId })
        issued++
      } catch (e) {
        if (e instanceof AppError && e.code === 'MISSING_DOCUMENT') skipped.push(inv.unitLabel ?? inv.userId)
        else throw e
      }
    }
    return { issued, alreadyIssued: covered.size, skipped }
  },

  /**
   * Confirma o pagamento. Com um provedor real isso vem do webhook (PAYMENT_RECEIVED); no
   * simulado, do botão da demo.
   */
  async simulatePayment(chargeId: string, scope: ChargeScope) {
    const c = await owned(chargeId, scope)
    if (!gateway.canSimulatePayment || c.provider !== gateway.provider) {
      throw new AppError('Pagamento só é confirmado pelo provedor', 400, 'VALIDATION')
    }
    if (c.status !== 'PENDING') throw new AppError('Esta cobrança não está em aberto', 409, 'CONFLICT')
    await settle(c)
    return toDto((await chargesRepository.find(c.id))!)
  },

  /**
   * Webhook do provedor (Asaas). Idempotente: o Asaas reenvia eventos, então só age sobre
   * cobrança ainda em aberto, e confere o valor antes de dar baixa.
   */
  async onProviderEvent(provider: string, eventId: string, event: string, externalId: string, valueCents: number) {
    const c = await chargesRepository.findByExternalId(provider, externalId)
    if (!c) return
    // todo evento conhecido vai para o histórico (o painel mostra); só alguns mudam a cobrança
    if (!(await chargesRepository.recordEvent(c.id, provider, eventId, event))) return
    if (c.status !== 'PENDING') {
      // pago depois de cancelado (ex.: boleto pago junto com o Pix): o dinheiro entrou, avisa
      if (event === 'PAYMENT_RECEIVED') {
        console.error(`[asaas] pagamento recebido em cobrança ${c.status} ${externalId}: conferir e estornar`)
      }
      return
    }
    if (event === 'PAYMENT_RECEIVED') {
      if (valueCents !== c.amountCents) {
        console.error(`[asaas] valor divergente em ${externalId}: recebido ${valueCents}, esperado ${c.amountCents}`)
        return
      }
      await settle(c)
    } else if (event === 'PAYMENT_DELETED') {
      await chargesRepository.cancel([c.id])
    }
  },

  async cancel(chargeId: string, scope: ChargeScope) {
    const c = await owned(chargeId, scope)
    if (c.status !== 'PENDING') throw new AppError('Só dá para cancelar cobrança em aberto', 409, 'CONFLICT')
    await gatewayOf(c.provider).cancelCharge(c.externalId)
    await chargesRepository.cancel([c.id])
    return toDto((await chargesRepository.find(c.id))!)
  },

  /** Painel do gestor: cobranças do ciclo, com totais por situação e por forma de pagamento. */
  async ofPeriod(workspaceId: string, period: string) {
    const rows = await chargesRepository.ofPeriod(workspaceId, period)
    const charges = await Promise.all(
      rows.map(async (r) => ({ ...(await toDto(r.charge)), name: r.name, unitLabel: r.unitLabel })),
    )
    // Eventos: os do webhook, gravados de verdade. O simulado não tem webhook, então os dele
    // são derivados das datas da cobrança (formato idêntico).
    const byId = new Map(charges.map((c) => [c.id, c]))
    const recorded = (await chargesRepository.eventsOfPeriod(workspaceId, period, 8)).flatMap((e) => {
      const c = byId.get(e.chargeId)
      return c ? [{ chargeId: c.id, kind: e.kind, at: e.at.toISOString() }] : []
    })
    const derived = charges
      .filter((c) => c.provider === 'simulado')
      .flatMap((c) => [
        { chargeId: c.id, kind: 'PAYMENT_CREATED', at: c.createdAt },
        ...(c.paidAt ? [{ chargeId: c.id, kind: 'PAYMENT_RECEIVED', at: c.paidAt }] : []),
        ...(c.cancelledAt ? [{ chargeId: c.id, kind: 'PAYMENT_DELETED', at: c.cancelledAt }] : []),
      ])
      .map((e) => ({ ...e, at: new Date(e.at).toISOString() }))
    const events = [...recorded, ...derived].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
    const sum = (f: (c: (typeof charges)[number]) => boolean) =>
      charges.filter(f).reduce((a, c) => ({ count: a.count + 1, cents: a.cents + c.amountCents }), { count: 0, cents: 0 })
    return {
      period,
      provider: gateway.provider,
      charges,
      events,
      totals: {
        pending: sum((c) => c.status === 'PENDING'),
        overdue: sum((c) => c.status === 'OVERDUE'),
        received: sum((c) => c.status === 'RECEIVED'),
        receivedPix: sum((c) => c.status === 'RECEIVED' && c.method === 'PIX'),
        receivedBoleto: sum((c) => c.status === 'RECEIVED' && c.method === 'BOLETO'),
      },
    }
  },

  /** Antes de recalcular o ciclo: as faturas pendentes vão ser refeitas, então as cobranças caem. */
  async cancelOpenOf(invoiceIds: string[]) {
    const active = await chargesRepository.activeOf(invoiceIds)
    for (const c of active) await gatewayOf(c.provider).cancelCharge(c.externalId)
    await chargesRepository.cancel(active.map((c) => c.id))
  },

  /** Baixa manual pelo gestor ("marcar paga" / "desfazer"): mantém as cobranças coerentes. */
  async onManualStatus(invoiceId: string, status: 'PENDING' | 'PAID') {
    if (status === 'PAID') return chargesService.cancelOpenOf([invoiceId])
    // Estorna no provedor antes de mexer no banco: se ele recusar (ex.: boleto não tem estorno),
    // a cobrança continua RECEIVED e a fatura continua paga, em vez de ficarem divergentes.
    const received = await chargesRepository.receivedOf(invoiceId)
    for (const c of received) await gatewayOf(c.provider).refundCharge(c.externalId)
    await chargesRepository.markRefunded(received.map((c) => c.id))
  },
}
