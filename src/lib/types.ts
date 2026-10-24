/** Contratos das rotas do server/ consumidas pelo app (espelham os services do backend). */

/** Papel na plataforma. O papel em cada condomínio (síndico, morador...) vem do vínculo. */
export type Role = 'SUPER_ADMIN' | 'USER'
export type MemberRole = 'ADMIN' | 'USER'
export type AdminTitle = 'SINDICO' | 'SUBSINDICO'
/** MORADOR tem unidade e entra no rateio; CONVIDADO mora em outro condomínio e paga só o consumo. */
export type MemberKind = 'MORADOR' | 'CONVIDADO'

/** Condomínio ativo do app (header X-Workspace-Id), com o papel de quem está logado nele. */
export type ActiveWorkspace = {
  id: string
  name: string
  archived: boolean
  /** null: superadmin olhando um condomínio de que não participa */
  memberRole: MemberRole | null
  adminTitle: AdminTitle | null
  kind: MemberKind | null
}

export type Membership = {
  workspaceId: string
  name: string
  role: MemberRole
  adminTitle: AdminTitle | null
  kind: MemberKind
  unitId: string | null
  unitLabel: string | null
}

export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type MyJoinRequest = {
  id: string
  workspaceId: string
  workspaceName: string
  status: JoinRequestStatus
  message: string | null
  createdAt: string
  decidedAt: string | null
}

/** Pedido de acesso visto pelo admin do condomínio. */
export type JoinRequest = {
  id: string
  userId: string
  name: string
  email: string
  status: JoinRequestStatus
  message: string | null
  createdAt: string
  decidedAt: string | null
}

/** Condomínio na tela do superadmin. */
export type WorkspaceSummary = {
  id: string
  name: string
  address: string | null
  archivedAt: string | null
  createdAt: string
  residents: number
  guests: number
  pendingRequests: number
  admins: { userId: string; name: string; email: string; title: AdminTitle | null }[]
}
export type PriceLevel = 'cheap' | 'mid' | 'peak'

export type Vehicle = {
  id: string
  model: string
  plate: string | null
  capacityKwh: number
  rangeKm: number | null
  maxChargeKw: number
}

export type Me = {
  user: { id: string; role: Role; name: string; email: string; hasDocument: boolean }
  /** null: conta sem nenhum condomínio ativo */
  workspace: ActiveWorkspace | null
  memberships: Membership[]
  joinRequests: MyJoinRequest[]
  unit: { id: string; label: string } | null
  station: { id: string; name: string; address: string | null } | null
  charger: { id: string; maxPowerKw: number; telemetry: boolean } | null
  vehicles: Vehicle[]
  cards: { id: string; cardNumber: string; label: string | null; active: boolean }[]
}

export type Session = {
  id: string
  chargerId: string
  startedAt: string
  endedAt: string | null
  energyKwh: number
  greenKwh: number | null
  gridKwh: number | null
  durationMin: number | null
  mileageKm: number | null
  cardNumber: string | null
  idleMin: number
  demand: number | null
  mult: number | null
  level: PriceLevel | null
  energyCostCents: number | null
  chargedCents: number | null
  tariffBaseCentsKwh: number | null
  assignedManually: boolean
  userId: string | null
  userName: string | null
  unitLabel: string | null
  memberKind: MemberKind | null
}

export type InvoiceState = 'OPEN' | 'PENDING' | 'PAID' | 'OVERDUE' | 'EXEMPT'

export type CycleLine = {
  userId: string
  kind: MemberKind | null
  name: string
  email: string
  unitLabel: string | null
  active: boolean
  sessionsCount: number
  energyKwh: number
  energyCostCents: number
  chargedCents: number
  surplusCents: number
  fixedShareCents: number
  creditCents: number
  /** ajustes do gestor para esta pessoa no ciclo (crédito negativo, débito positivo) */
  adjustmentCents: number
  totalCents: number
  status: InvoiceState
  invoiceId: string | null
  dueDate: string
}

/** Lançamento do gestor no ciclo: despesa extra (rateada) ou ajuste de uma pessoa. */
export type CycleEntry = {
  id: string
  kind: 'DESPESA' | 'AJUSTE'
  description: string
  amountCents: number
  userId?: string | null
  userName?: string | null
  createdAt: string
}

export type Cycle = {
  period: string
  closed: boolean
  dueDate: string
  fixedMonthlyCostCents: number
  /** despesas extras lançadas no ciclo, rateadas junto com o custo fixo */
  expensesCents: number
  entries: CycleEntry[]
  /** custo fixo efetivamente dividido (menos o excedente pago por convidados) */
  fixedSplitCents: number
  /** moradores que carregaram no ciclo (dividem o custo fixo) */
  activeUsers: number
  registeredUsers: number
  lines: CycleLine[]
  totals: {
    energyKwh: number
    energyCostCents: number
    chargedCents: number
    creditCents: number
    adjustmentCents: number
    fixedShareCents: number
    totalCents: number
  }
  /** recargas atribuídas que entraram depois do fechamento e não estão em nenhuma fatura */
  notInvoiced: number
  unassigned: { count: number; energyKwh: number }
}

export type MyInvoice = {
  period: string
  closed: boolean
  activeUsers: number
  fixedMonthlyCostCents: number
  fixedSplitCents: number
  expensesCents: number
  /** despesas extras do condomínio e os ajustes desta pessoa no ciclo */
  entries: CycleEntry[]
  line: CycleLine | null
  previousTotalCents: number | null
  sessions: Session[]
  charges: Charge[]
}

export type ChargeMethod = 'PIX' | 'BOLETO'
export type ChargeState = 'PENDING' | 'OVERDUE' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED'

/** Cobrança de uma fatura no gateway (Asaas, ou simulado na demo). */
export type Charge = {
  id: string
  invoiceId: string
  provider: string
  externalId: string
  method: ChargeMethod
  status: ChargeState
  amountCents: number
  dueDate: string
  pix: { payload: string; expiresAt: string; qrCodeImage: string | null } | null
  boleto: { digitableLine: string; barcode: string; nossoNumero: string } | null
  canSimulatePayment: boolean
  paidAt: string | null
  cancelledAt: string | null
  createdAt: string
}

type Sum = { count: number; cents: number }
export type ChargesOfPeriod = {
  period: string
  provider: string
  charges: (Charge & { name: string; unitLabel: string | null })[]
  /** Eventos do provedor (webhook), mais recentes primeiro. */
  events: { chargeId: string; kind: string; at: string }[]
  totals: { pending: Sum; overdue: Sum; received: Sum; receivedPix: Sum; receivedBoleto: Sum }
}

export type HourPrice = { at: string; demand: number; mult: number; priceCentsKwh: number; level: PriceLevel }
export type PriceCurve = { basePriceCentsKwh: number; hours: HourPrice[] }

/** PENDING_PLUGIN: regra "meta % + prazo" ainda sem horário — resolve sozinha quando o carro
 * pluga de verdade. EXPIRED: passou do prazo sem plugar. SCHEDULED com `startSoc` nulo: reserva
 * por horário de início, com o fim estimado até o carro plugar e a bateria ser lida. */
export type ReservationStatus = 'PENDING_PLUGIN' | 'SCHEDULED' | 'CANCELLED' | 'EXPIRED'

export type Reservation = {
  id: string
  chargerId: string
  vehicleId: string | null
  vehicleModel?: string | null
  startsAt: string | null
  endsAt: string | null
  startSoc: number | null
  targetSoc: number
  energyKwh: number | null
  estimatedCostCents: number | null
  deadlineAt: string
  status: ReservationStatus
  /** Local da reserva (vem em `/api/me/reservations`). */
  stationName?: string | null
  stationAddress?: string | null
  stationKind?: StationKind | null
}

export type Busy = { startsAt: string; endsAt: string; mine: boolean }

/** Horário em que dá pra começar a carregar; `now` = "Agora" (fora da hora cheia). `level` é o
 * da tarifa no meio da janela, não só na hora de início. */
export type StartSlot = {
  startsAt: string
  endsAt: string
  now: boolean
  level: PriceLevel
  costCents: number | null
  free: boolean
}
/** `hours`: duração estimada de cada janela, carregando de `assumedStartSoc` até a meta.
 * `socDeclared`: `assumedStartSoc` é a bateria que o morador informou (começar agora), não os 20% assumidos.
 * `partnerBaseCentsKwh`: no parceiro, o preço informado que a demanda faz variar (null no condomínio).
 * `telemetry`: o carregador lê a bateria quando o carro pluga (só o do condomínio). */
export type StartSlots = {
  hours: number
  assumedStartSoc: number
  socDeclared: boolean
  telemetry: boolean
  partnerBaseCentsKwh: number | null
  slots: StartSlot[]
}

/** Janela de carga calculada pelo servidor ("já plugado"). */
export type ChargeWindow = { start: string; end: string; hours: number; costCents: number; level: PriceLevel }
/** Prévia do "já plugado" pra uma meta: começa agora; `window` é quando fica pronto e o custo
 * (null se bate com a reserva seguinte). `soc`: bateria lida na telemetria (null: a conta parte
 * de `assumedStartSoc`). */
export type PlugInPreview = {
  soc: number | null
  assumedStartSoc: number
  energyKwh: number
  window: ChargeWindow | null
}

export type StationKind = 'CONDOMINIO' | 'PARCEIRO' | 'PUBLICO'

export type Station = {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  kind: StationKind
  openingHours: string | null
  publicPriceCentsKwh: number | null
  imageUrl: string | null
  /** condomínio dono (só estação CONDOMINIO); parceiros e pontos públicos são da rede */
  workspace: { id: string; name: string } | null
  chargers: { id: string; maxPowerKw: string; externalId: string | null; connector: string | null }[]
  live: {
    status: string
    workState: string
    collectedAt: string
    /** Sessão em andamento (tempo, energia, autonomia ganha, potência) — só quando carregando. */
    session: { minutes: number; kwh: number; km: number; powerKw: number | null } | null
  } | null
  /** Carro plugado agora (gun inserido ou carregando) — só quando há telemetria. */
  pluggedIn: boolean | null
  /** SOC real do carro plugado agora, só quando `pluggedIn`. */
  soc: number | null
  free: number | null
  total: number
  priceNowCentsKwh: number | null
  priceLevelNow: PriceLevel | null
}

export type Alert = { tone: 'warn' | 'ok' | 'info'; title: string; detail: string }

export type Overview = {
  period: string
  energyKwh: number
  prevEnergyKwh: number
  sessionsCount: number
  peakShare: number
  greenShare: number | null
  activeUsers: number
  registeredUsers: number
  billedCents: number
  closed: boolean
  openInvoices: number
  unassigned: { count: number; energyKwh: number }
  collector: { tokenOk: boolean | null; lastPoll: string | null; lastError: string | null; lastCollect: string | null }
  alerts: Alert[]
}

export type Demand = {
  historyStart: string | null
  sessions: number
  observed: number[][]
  predicted: number[][]
}

export type Forecast = {
  available: boolean
  reason: string | null
  hours: { at: string; multiplier: number }[]
  cheapest_at: string | null
  model_version: string | null
}

export type AdminUser = {
  id: string
  name: string
  email: string
  role: MemberRole
  adminTitle: AdminTitle | null
  kind: MemberKind
  unitId: string | null
  unitLabel: string | null
  /** tem CPF/CNPJ informado (o número em si não sai do servidor) */
  hasDocument: boolean
  cards: { id: string; cardNumber: string; label: string | null; active: boolean }[]
  vehicles: { id: string; model: string; plate: string | null }[]
}

export type Unit = { id: string; label: string; stationId: string | null; stationName: string | null; residents: number }

export type Card = {
  id: string
  cardNumber: string
  label: string | null
  active: boolean
  userId: string
  userName: string
}

export type Settings = {
  name: string
  fixedMonthlyCostCents: number
  idleCentsPerMinute: number
  idleGraceMinutes: number
  dueDay: number
  basePriceCentsKwh: number | null
}

/** Agenda do gestor (`/api/admin/reservations`): reservas e sessões reais num intervalo. */
export type AgendaReservation = Reservation & {
  userId: string
  occupiedFromAt: string | null
  createdAt: string
  userName: string
  unitLabel: string | null
  memberKind: 'MORADOR' | 'CONVIDADO' | null
  vehiclePlate: string | null
}
export type AgendaSession = {
  id: string
  chargerId: string
  startedAt: string
  endedAt: string | null
  energyKwh: number
  userId: string | null
  userName: string | null
  unitLabel: string | null
}
export type Agenda = {
  chargers: { id: string; stationName: string; maxPowerKw: string; connector: string | null }[]
  reservations: AgendaReservation[]
  sessions: AgendaSession[]
}
