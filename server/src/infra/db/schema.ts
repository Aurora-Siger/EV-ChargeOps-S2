import { relations, sql } from 'drizzle-orm'
import {
  boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, doublePrecision,
  unique, uniqueIndex,
} from 'drizzle-orm/pg-core'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const createdAt = () => timestamp('created_at').notNull().defaultNow()
const updatedAt = () => timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date())

// ---------- Better Auth (núcleo). Regenerar com `npm run auth:schema` ao adicionar plugins ----------

// Papel na plataforma inteira. O papel dentro de cada condomínio fica no vínculo (workspace_member).
export const platformRole = pgEnum('platform_role', ['SUPER_ADMIN', 'USER'])

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: platformRole('role').notNull().default('USER'),
  cpfCnpj: text('cpf_cnpj'), // só dígitos; o Asaas exige para emitir cobrança
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('session_user_idx').on(t.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('account_user_idx').on(t.userId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ---------- Workspaces: cada um é um condomínio ----------

// Condomínio não é apagado: arquivado, some das listas e do mapa e o histórico fica.
export const workspace = pgTable('workspace', {
  id: id(),
  name: text('name').notNull(),
  address: text('address'),
  archivedAt: timestamp('archived_at'),
  createdAt: createdAt(),
})

export const memberRole = pgEnum('member_role', ['ADMIN', 'USER'])
// Admin do condomínio é o síndico ou o subsíndico: no máximo um de cada.
export const adminTitle = pgEnum('admin_title', ['SINDICO', 'SUBSINDICO'])
// MORADOR tem unidade e entra no rateio do custo fixo; CONVIDADO mora em outro condomínio,
// entrou por um pedido de acesso aprovado e paga só o que consome.
export const memberKind = pgEnum('member_kind', ['MORADOR', 'CONVIDADO'])

export const workspaceMember = pgTable('workspace_member', {
  workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull().default('USER'),
  adminTitle: adminTitle('admin_title'),
  kind: memberKind('kind').notNull().default('MORADOR'),
  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index('member_user_idx').on(t.userId),
  unique('member_admin_title_uq').on(t.workspaceId, t.adminTitle), // NULLs não colidem
  check('member_admin_title_ck', sql`(${t.role} = 'ADMIN') = (${t.adminTitle} IS NOT NULL)`),
])

export const joinRequestStatus = pgEnum('join_request_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])

// Pedido de quem quer carregar num condomínio que não é o seu; o admin de lá aprova ou recusa.
export const workspaceJoinRequest = pgTable('workspace_join_request', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: joinRequestStatus('status').notNull().default('PENDING'),
  decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at'),
  createdAt: createdAt(),
}, (t) => [
  index('join_request_ws_idx').on(t.workspaceId, t.status),
  uniqueIndex('join_request_pending_uq').on(t.workspaceId, t.userId).where(sql`status = 'PENDING'`),
])

// ---------- Domínio ----------

// CONDOMINIO = carregador do próprio prédio (cobrado pelo rateio); PARCEIRO/PUBLICO = pontos
// da rede mostrados no mapa, com preço informado pelo operador do local.
export const stationKind = pgEnum('station_kind', ['CONDOMINIO', 'PARCEIRO', 'PUBLICO'])

export const station = pgTable('station', {
  id: id(),
  // Só a estação CONDOMINIO tem dono; parceiros e pontos públicos são da rede (null).
  workspaceId: text('workspace_id').references(() => workspace.id),
  name: text('name').notNull(),
  address: text('address'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  externalId: text('external_id').unique(), // id no SEMS
  kind: stationKind('kind').notNull().default('PARCEIRO'),
  openingHours: text('opening_hours'),
  // Só para pontos de fora do condomínio; o do condomínio usa tarifa base × mult do rateio.
  publicPriceCentsKwh: integer('public_price_cents_kwh'),
  // Opcional — sem uma cadastrada, o front mostra um preview gerado (ver placeholderGradient).
  imageUrl: text('image_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const charger = pgTable('charger', {
  id: id(),
  stationId: text('station_id').notNull().references(() => station.id, { onDelete: 'cascade' }),
  externalId: text('external_id').unique(),
  maxPowerKw: numeric('max_power_kw', { precision: 8, scale: 2 }).notNull(),
  connector: text('connector'),
}, (t) => [index('charger_station_idx').on(t.stationId)])

// Dinheiro sempre em centavos (inteiro).
export const tariff = pgTable('tariff', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspace.id),
  name: text('name').notNull(),
  basePriceCentsKwh: integer('base_price_cents_kwh').notNull(),
  minPriceCentsKwh: integer('min_price_cents_kwh').notNull(), // guardrail inferior
  maxPriceCentsKwh: integer('max_price_cents_kwh').notNull(), // guardrail superior
  maxStepPercent: integer('max_step_percent').notNull().default(15),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
})

// Toda decisão de preço é registrada: auditoria e dataset de treino.
export const pricingDecision = pgTable('pricing_decision', {
  id: id(),
  chargerId: text('charger_id').notNull().references(() => charger.id),
  tariffId: text('tariff_id').references(() => tariff.id),
  priceCentsKwh: integer('price_cents_kwh').notNull(),
  basePriceCentsKwh: integer('base_price_cents_kwh').notNull(),
  strategy: text('strategy').notNull(), // "rules-v1", "ai-v1"...
  features: jsonb('features').notNull(),
  explanation: jsonb('explanation').notNull(),
  createdAt: createdAt(),
}, (t) => [index('decision_charger_idx').on(t.chargerId, t.createdAt)])

// Sessão de recarga no domínio, mapeada do sems_charge_log (sessions.service.ts). O valor
// cobrado segue o modelo de rateio (billing/domain): mult × (kWh × tarifa base + ociosidade).
export const chargeSession = pgTable('charge_session', {
  id: id(),
  chargerId: text('charger_id').notNull().references(() => charger.id),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  energyKwh: numeric('energy_kwh', { precision: 10, scale: 3 }),
  priceCents: integer('price_cents'), // cobrado: mult × (energia + ociosidade)
  decisionId: text('decision_id').unique().references(() => pricingDecision.id),
  serial: text('serial').unique(), // chargeSerialNumber da SEMS (dedup da ingestão)
  cardNumber: text('card_number'), // chargeCardNumber: liga a sessão ao morador pelo cartão RFID
  greenKwh: numeric('green_kwh', { precision: 10, scale: 3 }),
  gridKwh: numeric('grid_kwh', { precision: 10, scale: 3 }),
  durationMin: integer('duration_min'),
  mileageKm: numeric('mileage_km', { precision: 10, scale: 2 }),
  endCause: text('end_cause'),
  idleMin: integer('idle_min').notNull().default(0),
  tariffBaseCentsKwh: integer('tariff_base_cents_kwh'), // tarifa vigente quando a sessão entrou
  demand: numeric('demand', { precision: 5, scale: 4 }), // demanda prevista do slot (0..1)
  mult: numeric('mult', { precision: 5, scale: 4 }), // 0,5 + demanda
  energyCostCents: integer('energy_cost_cents'), // custo real (kWh × tarifa base, sem mult)
  // true quando o gestor atribuiu o morador à mão: a sincronização não sobrescreve.
  assignedManually: boolean('assigned_manually').notNull().default(false),
}, (t) => [
  index('session_charger_idx').on(t.chargerId, t.startedAt),
  index('session_user_idx2').on(t.userId, t.startedAt),
])

// ---------- Condomínio: unidades, moradores, cartões, veículos ----------

// O vínculo morador ↔ unidade fica em workspace_member (uma unidade por condomínio).
export const unit = pgTable('unit', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspace.id),
  label: text('label').notNull(), // "Apto 1204"
  stationId: text('station_id').references(() => station.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [unique('unit_workspace_label_uq').on(t.workspaceId, t.label)])

export const rfidCard = pgTable('rfid_card', {
  id: id(),
  cardNumber: text('card_number').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
})

export const vehicle = pgTable('vehicle', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  plate: text('plate'),
  capacityKwh: numeric('capacity_kwh', { precision: 6, scale: 2 }).notNull(),
  rangeKm: integer('range_km'),
  maxChargeKw: numeric('max_charge_kw', { precision: 6, scale: 2 }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('vehicle_user_idx').on(t.userId)])

// PENDING_PLUGIN: regra "meta % + prazo" sem horário resolvido ainda (agendamento "pra depois",
// sem SOC real disponível na hora de pedir). Vira SCHEDULED sozinha quando o carro pluga de
// verdade (sessions.service resolve com o SOC real da telemetria). EXPIRED: passou do prazo
// sem o carro plugar.
export const reservationStatus = pgEnum('reservation_status', ['PENDING_PLUGIN', 'SCHEDULED', 'CANCELLED', 'EXPIRED'])

export const reservation = pgTable('reservation', {
  id: id(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  chargerId: text('charger_id').notNull().references(() => charger.id, { onDelete: 'cascade' }),
  vehicleId: text('vehicle_id').references(() => vehicle.id, { onDelete: 'set null' }),
  // Nulos enquanto PENDING_PLUGIN: só existem depois que a janela é resolvida (agora, ou no
  // primeiro poll da SEMS depois que o carro pluga).
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  // Preenchido só quando o carro já estava plugado (fisicamente ocupando o carregador) antes do
  // horário escolhido começar — marca desde quando bloquear o carregador pra OUTRAS reservas, sem
  // mexer em startsAt (que continua sendo a janela de carga de verdade, pra preço/energia).
  occupiedFromAt: timestamp('occupied_from_at'),
  startSoc: integer('start_soc'),
  energyKwh: numeric('energy_kwh', { precision: 8, scale: 3 }),
  estimatedCostCents: integer('estimated_cost_cents'),
  targetSoc: integer('target_soc').notNull(),
  // Sempre presente: "pronto até" — o prazo que o morador pediu, em ambos os fluxos.
  deadlineAt: timestamp('deadline_at').notNull(),
  status: reservationStatus('status').notNull().default('SCHEDULED'),
  createdAt: createdAt(),
}, (t) => [index('reservation_charger_idx').on(t.chargerId, t.startsAt)])

// Parâmetros do rateio, uma linha por condomínio (o nome fica no workspace). Dinheiro em centavos.
export const condoSettings = pgTable('condo_settings', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspace.id),
  fixedMonthlyCostCents: integer('fixed_monthly_cost_cents').notNull(),
  idleCentsPerMinute: integer('idle_cents_per_minute').notNull(),
  idleGraceMinutes: integer('idle_grace_minutes').notNull(),
  dueDay: integer('due_day').notNull(),
  updatedAt: updatedAt(),
})

export const invoiceStatus = pgEnum('invoice_status', ['PENDING', 'PAID'])

// Fatura fechada de um ciclo (mês). Enquanto o ciclo está aberto, a fatura é calculada na hora.
export const invoice = pgTable('invoice', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspace.id),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  unitLabel: text('unit_label'),
  period: text('period').notNull(), // "2026-09"
  sessionsCount: integer('sessions_count').notNull(),
  energyKwh: numeric('energy_kwh', { precision: 10, scale: 3 }).notNull(),
  energyCostCents: integer('energy_cost_cents').notNull(),
  chargedCents: integer('charged_cents').notNull(),
  surplusCents: integer('surplus_cents').notNull(),
  fixedShareCents: integer('fixed_share_cents').notNull(),
  creditCents: integer('credit_cents').notNull(),
  // soma dos ajustes do gestor para esta pessoa no ciclo (crédito negativo, débito positivo)
  adjustmentCents: integer('adjustment_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  status: invoiceStatus('status').notNull().default('PENDING'),
  dueDate: date('due_date').notNull(),
  paidAt: timestamp('paid_at'),
  createdAt: createdAt(),
}, (t) => [unique('invoice_ws_user_period_uq').on(t.workspaceId, t.userId, t.period)])

// Lançamento do gestor num ciclo. DESPESA: custo extra do mês (manutenção, conta de luz da
// vaga...), somado ao custo fixo e rateado entre os moradores ativos. AJUSTE: valor na fatura de
// uma pessoa só (negativo = crédito, positivo = débito), com a descrição que ela vê na fatura.
export const cycleEntryKind = pgEnum('cycle_entry_kind', ['DESPESA', 'AJUSTE'])

export const cycleEntry = pgTable('cycle_entry', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspace.id),
  period: text('period').notNull(), // "2026-09"
  kind: cycleEntryKind('kind').notNull(),
  description: text('description').notNull(),
  amountCents: integer('amount_cents').notNull(),
  // só no AJUSTE: de quem é
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  index('cycle_entry_ws_period_idx').on(t.workspaceId, t.period),
  check('cycle_entry_kind_user_ck', sql`(${t.kind} = 'AJUSTE') = (${t.userId} IS NOT NULL)`),
])

// Cobrança de uma fatura num gateway de pagamento (Pix ou boleto). Hoje o gateway é simulado
// (infra/payments/simulated.ts); os campos seguem o que o Asaas devolve, para trocar de provedor
// sem mexer no domínio. Uma fatura pode ter uma cobrança ativa por forma de pagamento; quando
// uma é paga, as outras são canceladas.
export const chargeMethod = pgEnum('charge_method', ['PIX', 'BOLETO'])
export const chargeStatus = pgEnum('charge_status', ['PENDING', 'RECEIVED', 'CANCELLED', 'REFUNDED'])

export const paymentCharge = pgTable('payment_charge', {
  id: id(),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // "simulado", "asaas"...
  externalId: text('external_id').notNull().unique(), // id da cobrança no gateway
  method: chargeMethod('method').notNull(),
  status: chargeStatus('status').notNull().default('PENDING'),
  amountCents: integer('amount_cents').notNull(),
  dueDate: date('due_date').notNull(),
  pixPayload: text('pix_payload'), // Pix copia e cola (BR Code)
  pixExpiresAt: timestamp('pix_expires_at'),
  boletoDigitableLine: text('boleto_digitable_line'),
  boletoBarcode: text('boleto_barcode'), // 44 dígitos
  boletoNossoNumero: text('boleto_nosso_numero'),
  paidAt: timestamp('paid_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: createdAt(),
}, (t) => [index('payment_charge_invoice_idx').on(t.invoiceId)])

// Notificações do provedor (webhook), uma por evento. `eventId` é o id do evento no provedor
// (o Asaas reenvia o mesmo evento em caso de falha): a unicidade evita duplicar o registro.
export const paymentEvent = pgTable('payment_event', {
  id: id(),
  chargeId: text('charge_id').notNull().references(() => paymentCharge.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  kind: text('kind').notNull(), // PAYMENT_RECEIVED, PAYMENT_OVERDUE...
  createdAt: createdAt(),
}, (t) => [unique('payment_event_provider_event_uq').on(t.provider, t.eventId), index('payment_event_charge_idx').on(t.chargeId)])

// ---------- SEMS+ (GoodWe) — camada anti-corrupção do coletor ----------
// Payload bruto do gateway, ainda não mapeado para o domínio (charge_session etc.).
// Ver server/src/infra/sems/ e docs/ARCHITECTURE.md.

export const semsSnapshotKind = pgEnum('sems_snapshot_kind', [
  'detail', 'last_charge', 'capabilities', 'device_info', 'station_info', 'alarm_count',
])

export const semsSnapshot = pgTable('sems_snapshot', {
  id: id(),
  kind: semsSnapshotKind('kind').notNull(),
  collectedAt: timestamp('collected_at').notNull().defaultNow(),
  payload: jsonb('payload').notNull(),
}, (t) => [index('sems_snapshot_kind_idx').on(t.kind, t.collectedAt)])

// Dedup por chargeSerialNumber (ou timestamp de início quando a SEMS não manda serial).
export const semsChargeLog = pgTable('sems_charge_log', {
  serial: text('serial').primaryKey(),
  payload: jsonb('payload').notNull(),
  updatedAt: updatedAt(),
})

// Potência entregue (pEvChar, kW) a cada 5 min, da série temporal da SEMS+. Diz quando houve
// carga sem depender do status do `detail`, que congelou em "cabo fora" desde 19/09/2026.
export const semsPowerPoint = pgTable('sems_power_point', {
  sn: text('sn').notNull(),
  at: timestamp('at').notNull(),
  kw: doublePrecision('kw').notNull(),
}, (t) => [primaryKey({ columns: [t.sn, t.at] })])

export const stationRelations = relations(station, ({ many, one }) => ({
  chargers: many(charger),
  workspace: one(workspace, { fields: [station.workspaceId], references: [workspace.id] }),
}))
export const chargerRelations = relations(charger, ({ one }) => ({
  station: one(station, { fields: [charger.stationId], references: [station.id] }),
}))
