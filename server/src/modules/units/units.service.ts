import { NotFoundError } from '../../shared/errors.js'
import { stationsService } from '../stations/stations.service.js'
import { unitsRepository, type UnitInput } from './units.repository.js'

/** A unidade só aponta para estação do próprio condomínio. */
async function checkStation(workspaceId: string, stationId: string | null | undefined) {
  if (!stationId) return
  const st = await stationsService.get(stationId)
  if (st.workspaceId !== workspaceId) throw new NotFoundError('Estação')
}

export const unitsService = {
  list: (workspaceId: string) => unitsRepository.list(workspaceId),
  async create(workspaceId: string, u: UnitInput) {
    await checkStation(workspaceId, u.stationId)
    return unitsRepository.create(workspaceId, u)
  },
  async update(workspaceId: string, id: string, u: Partial<UnitInput>) {
    await checkStation(workspaceId, u.stationId)
    const row = await unitsRepository.update(workspaceId, id, u)
    if (!row) throw new NotFoundError('Unidade')
    return row
  },
  async remove(workspaceId: string, id: string) {
    if (!(await unitsRepository.find(workspaceId, id))) throw new NotFoundError('Unidade')
    await unitsRepository.remove(id) // moradores ficam sem unidade (FK set null)
  },
  /** Unidade existe e é deste condomínio? */
  async check(workspaceId: string, id: string | null | undefined) {
    if (id && !(await unitsRepository.find(workspaceId, id))) throw new NotFoundError('Unidade')
  },
}
