/**
 * Pontos de recarga do mapa, vindos de `/api/stations` (cadastrados pelo gestor).
 * Ocupação só existe onde há telemetria (o carregador ligado à SEMS); nos demais `free` é
 * null e a tela mostra "—" em vez de inventar vagas.
 */
import type { PriceLevel, Station, StationKind } from './types'

/** `seu`: condomínio de que a pessoa participa; `condominio`: outro condomínio da rede (pede acesso). */
export type PointKind = 'seu' | 'condominio' | 'parceiro' | 'publico'

export type ChargePoint = {
  id: string
  /** condomínio dono (só estação de condomínio) */
  workspaceId: string | null
  name: string
  address: string
  kind: PointKind
  lat: number
  lon: number
  /** tomadas livres (null = sem telemetria) / total */
  free: number | null
  total: number
  /** kW por tomada */
  power: number
  /** R$/kWh agora (tarifa dinâmica no condomínio, preço informado nos demais) */
  price: number | null
  priceLevel: PriceLevel | null
  /** aberto ao público em que horários */
  hours: string | null
}

const KIND: Record<StationKind, PointKind> = { CONDOMINIO: 'seu', PARCEIRO: 'parceiro', PUBLICO: 'publico' }

/**
 * `mine`: condomínios da pessoa logada. Sem ele (site público), todo condomínio aparece como
 * "seu", como antes dos workspaces.
 */
export function toChargePoint(s: Station, mine?: ReadonlySet<string>): ChargePoint | null {
  if (s.latitude === null || s.longitude === null) return null
  const priceCents = s.priceNowCentsKwh ?? s.publicPriceCentsKwh
  const outsider = s.kind === 'CONDOMINIO' && mine !== undefined && !(s.workspace && mine.has(s.workspace.id))
  return {
    id: s.id,
    workspaceId: s.workspace?.id ?? null,
    name: s.name,
    address: s.address ?? '',
    kind: outsider ? 'condominio' : KIND[s.kind],
    lat: s.latitude,
    lon: s.longitude,
    free: s.free,
    total: s.total,
    power: s.chargers.length ? Math.max(...s.chargers.map((c) => Number(c.maxPowerKw))) : 0,
    price: priceCents === null ? null : priceCents / 100,
    priceLevel: s.priceLevelNow,
    hours: s.openingHours,
  }
}

export const KIND_LABEL: Record<PointKind, string> = {
  seu: 'Seu condomínio',
  condominio: 'Condomínio da rede',
  parceiro: 'Parceiro da rede',
  publico: 'Público',
}

export const KIND_COLOR: Record<PointKind, string> = {
  seu: '#e8185a',
  condominio: '#a78bfa',
  parceiro: '#f472b6',
  publico: '#34d399',
}

const PHOTO_GRADIENTS = [
  'linear-gradient(135deg, #1a1c27 0%, #2a1420 65%, rgba(232, 24, 90, 0.28) 100%)',
  'linear-gradient(135deg, #12181f 0%, #0f2a22 65%, rgba(52, 211, 153, 0.24) 100%)',
  'linear-gradient(135deg, #1c1710 0%, #2a2010 65%, rgba(245, 158, 11, 0.24) 100%)',
  'linear-gradient(135deg, #14161f 0%, #1e1530 65%, rgba(167, 139, 250, 0.24) 100%)',
  'linear-gradient(135deg, #10171f 0%, #122430 65%, rgba(56, 189, 248, 0.24) 100%)',
]

/** Fundo decorativo estável por local (mesma semente = sempre o mesmo), pra quando a estação não tem `imageUrl` cadastrada. */
export function placeholderGradient(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PHOTO_GRADIENTS[h % PHOTO_GRADIENTS.length]
}

/** distância em km entre dois pontos (haversine) */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function fmtDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

/** minutos a pé, ~4,5 km/h */
export function walkMinutes(km: number) {
  return Math.max(1, Math.round((km / 4.5) * 60))
}

export function fmtPrice(p: ChargePoint) {
  return p.price === null ? '—' : `R$ ${p.price.toFixed(2).replace('.', ',')}`
}

export function fmtFree(p: ChargePoint) {
  if (p.free === null) return '—'
  return p.free === 0 ? 'ocupado' : `${p.free}/${p.total} livre`
}

export function directionsUrl(p: ChargePoint) {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`
}
