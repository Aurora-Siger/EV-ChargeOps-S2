import { labels } from './i18n'
/**
 * Rótulos do carregador GoodWe HCA G2 (SEMS+) em português. Os dados em si vêm do backend
 * (`src/lib/api.ts` → `/api/sems-proxy`), coletados pelo `server/src/modules/sems`.
 */

/** Estados possíveis do plugue, traduzidos para o português do app */
export const WORK_STATE_LABEL: Record<string, string> = labels({
  available_gun_no_insered: ['Plugue livre, sem carro conectado', 'Plug free, no car connected'],
  available_gun_insered: ['Carro conectado, aguardando início', 'Car connected, waiting to start'],
  charging: ['Carregando', 'Charging'],
  finish: ['Carga concluída', 'Charge complete'],
  fault: ['Falha no equipamento', 'Equipment fault'],
})

export const STATUS_LABEL: Record<string, string> = labels({
  available: ['Disponível', 'Available'],
  charging: ['Carregando', 'Charging'],
  fault: ['Falha', 'Fault'],
  offline: ['Offline', 'Offline'],
})

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h === 0 ? `${m}min` : `${h}h${String(m).padStart(2, '0')}`
}
