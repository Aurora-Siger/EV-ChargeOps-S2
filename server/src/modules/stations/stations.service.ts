import { env } from '../../config/env.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { isOccupied, semsService, type LiveTelemetry } from '../sems/sems.service.js'
import { workspacesRepository } from '../workspaces/workspaces.repository.js'
import { stationsRepository, type StationInput } from './stations.repository.js'

/** Quem cadastra estação pelo painel: o condomínio ativo e se é o superadmin. */
export type StationScope = { workspaceId: string; superAdmin: boolean }

/**
 * Estação de condomínio pertence ao condomínio ativo, ou ao que o superadmin escolher (ele
 * transforma um ponto da rede em condomínio de outro prédio). Parceiros e pontos públicos são
 * da rede inteira (sem dono): só o superadmin cadastra.
 */
async function ownerFor(kind: StationInput['kind'], scope: StationScope, requested?: string | null) {
  if (kind === 'CONDOMINIO') {
    if (!scope.superAdmin || !requested || requested === scope.workspaceId) return scope.workspaceId
    const ws = await workspacesRepository.find(requested)
    if (!ws || ws.archivedAt) throw new NotFoundError('Condomínio')
    return ws.id
  }
  if (!scope.superAdmin) throw new ForbiddenError('Parceiros e pontos públicos são cadastrados pelo administrador da plataforma')
  return null
}

export const stationsService = {
  /**
   * Quem está carregando agora no carregador da SEMS, pelo cartão RFID da sessão em andamento.
   * Só o primeiro nome (vai para outros moradores). `null` se está livre ou o cartão não é de ninguém.
   */
  async occupant(userId: string) {
    const live = await semsService.live()
    const card = live && isOccupied(live) ? live.session?.cardNumber : null
    if (!card) return null
    const owner = await stationsRepository.ownerOfCard(card)
    return owner ? { name: owner.name.trim().split(/\s+/)[0]!, isMe: owner.id === userId } : null
  },

  /**
   * Lista para o mapa. Só o carregador ligado à SEMS tem ocupação real; os demais não têm
   * telemetria integrada, então `free` vem `null` (o front mostra "sem telemetria") em vez de
   * um número inventado. Estação de condomínio arquivado não aparece.
   */
  async list() {
    const [rows, live] = await Promise.all([stationsRepository.list(), semsService.live()])
    return rows
      .filter((s) => !s.workspace?.archivedAt)
      .map(({ workspace, ...s }) => {
        const semsCharger = s.chargers.find((c) => c.externalId === env.SEMS_SN)
        const l: LiveTelemetry | null = semsCharger ? live : null
        return {
          ...s,
          workspace: workspace && { id: workspace.id, name: workspace.name },
          live: l && { status: l.status, workState: l.workState, collectedAt: l.collectedAt, session: l.session && { ...l.session, cardNumber: undefined } },
          pluggedIn: l ? isOccupied(l) : null,
          soc: l && isOccupied(l) ? l.soc : null,
          total: s.chargers.length,
          free: l ? s.chargers.length - (isOccupied(l) ? 1 : 0) : null,
        }
      })
  },
  async get(id: string) {
    const station = await stationsRepository.findById(id)
    if (!station) throw new NotFoundError('Estação')
    return station
  },

  chargerById: (id: string) => stationsRepository.chargerById(id),
  chargerWithStation: (id: string) => stationsRepository.chargerWithStation(id),
  isSemsCharger: (c: { externalId: string | null }) => c.externalId === env.SEMS_SN,
  /** Condomínio dono do carregador; null para parceiro/ponto público (ou carregador inexistente). */
  workspaceOfCharger: async (chargerId: string) =>
    (await stationsRepository.chargerWithStation(chargerId))?.station.workspaceId ?? null,
  /** Carregador "padrão" do condomínio (o com telemetria, se houver). */
  homeChargerOf: async (workspaceId: string) => (await stationsRepository.condoChargersOf(workspaceId))[0]?.id ?? null,

  /**
   * Garante que existe um `charger` com external_id = SEMS_SN, para onde as sessões da SEMS
   * vão. Reaproveita o primeiro carregador de condomínio ainda sem vínculo (o do seed) e só
   * cria uma estação nova, no condomínio mais antigo, se não houver nenhum.
   */
  async ensureSemsCharger(): Promise<string> {
    const existing = await stationsRepository.chargerByExternalId(env.SEMS_SN)
    if (existing) return existing.id
    const candidate = await stationsRepository.firstCondoChargerWithoutExternalId()
    if (candidate) {
      await stationsRepository.setChargerExternalId(candidate.id, env.SEMS_SN)
      return candidate.id
    }
    const ws = await workspacesRepository.firstActive()
    if (!ws) throw new AppError('Nenhum condomínio cadastrado para receber o carregador da SEMS', 409, 'CONFLICT')
    const created = await stationsRepository.create(
      { name: 'Carregador do condomínio', kind: 'CONDOMINIO', openingHours: '24h para moradores', workspaceId: ws.id },
      7,
      env.SEMS_SN,
    )
    return created.charger.id
  },

  semsChargerId: async () => (await stationsRepository.chargerByExternalId(env.SEMS_SN))?.id ?? null,

  /** Estação que o painel do condomínio ativo pode editar (a dele; o superadmin edita qualquer uma). */
  async editable(scope: StationScope, id: string) {
    const st = await stationsService.get(id)
    if (st.workspaceId === scope.workspaceId || scope.superAdmin) return st
    if (st.workspaceId === null) throw new ForbiddenError('Parceiros e pontos públicos são editados pelo administrador da plataforma')
    throw new NotFoundError('Estação')
  },

  create: async (scope: StationScope, s: StationInput, maxPowerKw: number) =>
    stationsRepository.create({ ...s, workspaceId: await ownerFor(s.kind ?? 'PARCEIRO', scope, s.workspaceId) }, maxPowerKw),
  async update(scope: StationScope, id: string, s: Partial<StationInput>, maxPowerKw?: number) {
    const current = await stationsService.editable(scope, id)
    // sem `workspaceId` no corpo, a estação de condomínio fica no condomínio em que já está
    const requested = s.workspaceId === undefined ? current.workspaceId : s.workspaceId
    const { workspaceId: _ignored, ...rest } = s
    const patch = s.kind ? { ...rest, workspaceId: await ownerFor(s.kind, scope, requested) } : rest
    await stationsRepository.update(id, patch, maxPowerKw)
    return stationsService.get(id)
  },
  async remove(scope: StationScope, id: string) {
    const st = await stationsService.editable(scope, id)
    if (st.chargers.some((c) => c.externalId === env.SEMS_SN)) {
      throw new AppError('Esta estação recebe as sessões da SEMS e não pode ser apagada', 409, 'CONFLICT')
    }
    await stationsRepository.remove(id)
  },
}
