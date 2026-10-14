import { env } from '../../config/env.js'
import { semsState } from './sems.collector.js'
import { semsRepository } from './sems.repository.js'
import { liveFromTelemetry, type LiveTelemetry } from './domain/power.js'

export type { LiveTelemetry }

/** Ocupado = carregando ou com carro plugado (mesmo parado). */
export const isOccupied = (l: LiveTelemetry) =>
  l.status === 'charging' || l.workState === 'charging' || l.workState === 'available_gun_insered'

/** Porta de leitura do módulo SEMS para os outros módulos (sessions, stations, reservations, admin). */
export const semsService = {
  chargeLog: () => semsRepository.allChargeLog(),
  latestDetail: () => semsRepository.latestSnapshot('detail'),
  collectorState: () => ({ ...semsState }),

  /**
   * Estado ao vivo: último snapshot `detail` (status, ocupação, SOC real do carro plugado),
   * corrigido pela série de potência quando ela mostra carga e o `detail` não (domain/power.ts).
   */
  async live(): Promise<LiveTelemetry | null> {
    const [snap, power, lastCharge] = await Promise.all([
      semsRepository.latestSnapshot('detail'),
      semsRepository.latestPower(env.SEMS_SN),
      semsRepository.latestSnapshot('last_charge'),
    ])
    return liveFromTelemetry(snap, power, new Date(), lastCharge)
  },
}
