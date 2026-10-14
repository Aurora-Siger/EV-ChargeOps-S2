import { NotFoundError } from '../../shared/errors.js'
import { settingsRepository, type CondoSettingsPatch } from './settings.repository.js'

/**
 * Parâmetros do rateio de cada condomínio. Os valores padrão são de exemplo: o custo fixo
 * real e o valor do minuto ocioso são informados pelo gestor em Configurações.
 */
const DEFAULTS = {
  fixedMonthlyCostCents: 12_000,
  idleCentsPerMinute: 0,
  idleGraceMinutes: 15, // carência fixada no README do ev-chargeops-s1
  dueDay: 10,
}

export const settingsService = {
  async get(workspaceId: string) {
    let found = await settingsRepository.find(workspaceId)
    if (!found) {
      await settingsRepository.insertIfMissing(workspaceId, DEFAULTS)
      found = await settingsRepository.find(workspaceId)
    }
    if (!found) throw new NotFoundError('Condomínio')
    return { ...found.settings, name: found.name }
  },
  /** `name` é o nome do condomínio (workspace); o resto, os parâmetros do rateio. */
  async update(workspaceId: string, { name, ...patch }: CondoSettingsPatch & { name?: string }) {
    await settingsService.get(workspaceId)
    if (name !== undefined) await settingsRepository.rename(workspaceId, name)
    if (Object.keys(patch).length) await settingsRepository.update(workspaceId, patch)
    return settingsService.get(workspaceId)
  },
}
