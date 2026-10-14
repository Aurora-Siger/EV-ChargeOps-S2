/**
 * Estimativas de carga mostradas na tela de agendar. A escolha da janela de horário em si é
 * sempre feita no servidor (`reservations.service`/`scheduling.ts`) — o front nunca calcula
 * nem fixa preço.
 */
import type { Vehicle } from './types'

/** Metas de bateria oferecidas como pré-seleção */
export const TARGETS = [60, 80, 100]

/** Só faz sentido oferecer metas acima da bateria atual */
export function availableTargets(battery: number) {
  return TARGETS.filter((t) => t > battery + 1)
}

/** kW efetivos: o menor entre o carregador embarcado do carro e o carregador da vaga. */
export function chargeRateKw(vehicle: Vehicle, chargerMaxKw: number) {
  return Math.min(vehicle.maxChargeKw, chargerMaxKw)
}

export function energyNeeded(vehicle: Vehicle, battery: number, target: number) {
  return Math.max(0, ((target - battery) / 100) * vehicle.capacityKwh)
}
