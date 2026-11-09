import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  KIND_COLOR,
  KIND_LABEL,
  distanceKm,
  fmtDistance,
  type ChargePoint,
  type PointKind,
} from '../lib/chargePoints'
import { useChargePoints } from '../lib/chargePointsHook'
import { createBaseMap } from '../lib/leafletBase'
import { locale, t } from '../lib/i18n'

/**
 * "Onde carregar" do app: mapa limpo em cima e a lista de pontos embaixo, do mais perto ao mais
 * longe. Tocar num ponto (no mapa ou na lista) abre os detalhes e a ação dele.
 */

type Filter = 'todos' | Exclude<PointKind, 'seu'>

const filterOptions = (): { id: Filter; label: string }[] => [
  { id: 'todos', label: t('Todos', 'All') },
  { id: 'condominio', label: t('Condomínios', 'Buildings') },
  { id: 'parceiro', label: t('Parceiros', 'Partners') },
  { id: 'publico', label: t('Públicos', 'Public') },
]

const pinIcon = (p: ChargePoint, on: boolean) =>
  L.divIcon({
    html: `<span class="pm-pin ${on ? 'on' : ''} ${p.free === 0 ? 'busy' : ''}" style="--pin:${KIND_COLOR[p.kind]}"></span>`,
    className: 'pm-pin-wrap',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

const priceOf = (p: ChargePoint) =>
  p.price === null ? null : `R$ ${p.price.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function availability(p: ChargePoint) {
  if (p.free === null) return null
  return p.free === 0
    ? { text: t('Ocupado', 'Busy'), cls: 'busy' }
    : { text: p.total > 1 ? `${p.free} ${t('de', 'of')} ${p.total} ${t('livres', 'free')}` : t('Livre', 'Free'), cls: 'free' }
}

type Props = {
  onChoose: (p: ChargePoint) => void
  chooseLabel: (p: ChargePoint) => string
  myWorkspaces?: string[]
  activeWorkspaceId?: string
  height?: number
}

export default function PlacesMap({ onChoose, chooseLabel, myWorkspaces, activeWorkspaceId, height = 220 }: Props) {
  const { points, loading } = useChargePoints(myWorkspaces)
  const [filter, setFilter] = useState<Filter>('todos')
  const home = useMemo(
    () => points.find((p) => p.kind === 'seu' && p.workspaceId === activeWorkspaceId) ?? points.find((p) => p.kind === 'seu') ?? null,
    [points, activeWorkspaceId],
  )
  const [sel, setSel] = useState<string>('')
  const selId = sel || home?.id || ''
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markers = useRef<Record<string, L.Marker>>({})

  const center = home ?? points[0] ?? null
  const list = useMemo(() => {
    const ref = center ?? { lat: 0, lon: 0 }
    return points
      .filter((p) => filter === 'todos' || p.kind === filter || p.kind === 'seu')
      .map((p) => ({ ...p, km: distanceKm(ref, p) }))
      .sort((a, b) => (a.kind === 'seu' ? -1 : b.kind === 'seu' ? 1 : a.km - b.km))
  }, [points, filter, center])
  const kinds = new Set(points.map((p) => p.kind))
  const filters = filterOptions().filter((f) => f.id === 'todos' || kinds.has(f.id))

  useEffect(() => {
    if (!mapEl.current || !center) return
    const { map, cleanup } = createBaseMap(mapEl.current, [center.lat, center.lon], { zoom: 14, zoomControl: false })
    mapRef.current = map
    for (const p of points) {
      markers.current[p.id] = L.marker([p.lat, p.lon], { icon: pinIcon(p, false), title: p.name })
        .addTo(map)
        .on('click', () => setSel(p.id))
    }
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { padding: [28, 28], maxZoom: 15 })
    return () => {
      cleanup()
      mapRef.current = null
      markers.current = {}
    }
    // o mapa é criado uma vez por conjunto de pontos (o centro vem deles)
  }, [points])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const visible = new Set(list.map((p) => p.id))
    for (const p of points) {
      const m = markers.current[p.id]
      if (!m) continue
      m.setIcon(pinIcon(p, p.id === selId))
      m.setZIndexOffset(p.id === selId ? 1000 : 0)
      if (visible.has(p.id)) m.addTo(map)
      else m.remove()
    }
  }, [selId, list, points])

  const pick = (p: ChargePoint) => {
    setSel(p.id)
    mapRef.current?.panTo([p.lat, p.lon], { animate: true, duration: 0.4 })
  }

  if (points.length === 0) {
    return (
      <div className="empty-card">
        {loading ? t('Carregando pontos de recarga…', 'Loading charging points…') : t('Nenhum ponto de recarga cadastrado ainda.', 'No charging points registered yet.')}
      </div>
    )
  }

  return (
    <div className="pm">
      {filters.length > 1 && (
        <div className="seg seg-wide pm-filter">
          {filters.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="pm-map" style={{ height }}>
        <div className="pm-leaflet" ref={mapEl} />
      </div>

      <div className="pm-list">
        {list.map((p) => {
          const on = p.id === selId
          const av = availability(p)
          const price = priceOf(p)
          return (
            <div key={p.id} className={`pm-item ${on ? 'on' : ''}`}>
              <button className="pm-row" onClick={() => pick(p)} aria-expanded={on}>
                <span className="pm-dot" style={{ background: KIND_COLOR[p.kind] }} />
                <span className="pm-main">
                  <span className="pm-name">{p.name}</span>
                  <span className="pm-sub">
                    {KIND_LABEL[p.kind]}
                    {p.kind !== 'seu' && ` · ${fmtDistance(p.km)}`}
                  </span>
                </span>
                <span className="pm-side">
                  <b>{price ? `${price}/kWh` : '—'}</b>
                  {av && <span className={av.cls}>{av.text}</span>}
                </span>
              </button>
              {on && (
                <div className="pm-more">
                  {p.address && <div className="pm-addr">{p.address}</div>}
                  <div className="pm-facts">
                    <div>
                      <span>{t('Potência', 'Power')}</span>
                      <b>{p.power} kW</b>
                    </div>
                    <div>
                      <span>{t('Horário', 'Hours')}</span>
                      <b>{p.hours ?? '—'}</b>
                    </div>
                    <div>
                      <span>{t('Tarifa', 'Rate')}</span>
                      <b>{p.kind === 'seu' || p.kind === 'condominio' ? t('por horário', 'by time') : t('fixa', 'fixed')}</b>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm pm-cta" onClick={() => onChoose(p)}>
                    {chooseLabel(p)}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
